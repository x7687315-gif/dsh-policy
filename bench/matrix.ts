import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { HardRule, PolicyDocument } from '../src/policy/schema.ts'
import { buildStack, turnEndPayloads, userSay, editCall, testCall } from '../tests/integration/stack.ts'
import { textResponse, toolCallResponse } from '../tests/integration/mock-adapter.ts'
import { resolveContext } from '../src/context/resolver.ts'
import type { Resolution } from '../src/policy/resolver.ts'
import type { BehaviorGuardRule } from '../src/behavior/guard.ts'
import type { ResolvedPreference } from '../src/usermodel/preferences.ts'
import type { DshPolicyOptions } from '../src/plugin/index.ts'

/**
 * Stage 16 benchmark matrix (plan §Phase 18, roadmap §9).
 *
 * Deterministic replay corpus over the REAL Harness stack (ScriptedAdapter is
 * the only mock). The matrix functions here are shared by:
 *   - `bench/run.ts`  → full sweep, writes bench/report.json
 *   - the bench vitest test → pins the invariants so the report's headline
 *     rates cannot silently regress.
 */

export type ConstraintCaseKind = 'compliant' | 'violation-missing' | 'violation-fail' | 'no-change'

export interface ConstraintCaseResult {
  id: string
  rules: number
  noise: number
  kind: ConstraintCaseKind
  expectedEnd: 'completed' | 'error'
  actualEnd: 'completed' | 'error' | 'blocked' | 'aborted' | 'max-tokens' | 'none'
  /** Violation correctly refused / compliant correctly allowed. */
  correct: boolean
  requests: number
}

const testsPass: HardRule = { id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }
const typecheckPass: HardRule = { id: 'typecheck-required', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' }
const lintPass: HardRule = { id: 'lint-required', trigger: 'code_change', require: { kind: 'tool_pass', tool: 'bench_lint', passPattern: 'LINT OK' }, enforcement: 'hard' }
const buildPass: HardRule = { id: 'build-required', trigger: 'code_change', require: { kind: 'tool_pass', tool: 'bench_build', passPattern: 'BUILD OK' }, enforcement: 'hard' }

export const PASS_RULES: Record<number, HardRule[]> = {
  1: [testsPass],
  2: [testsPass, typecheckPass],
  4: [testsPass, typecheckPass, lintPass, buildPass],
}

export function policyFor(rules: number): PolicyDocument {
  return { project: 'bench', policy: { hard: PASS_RULES[rules] ?? PASS_RULES[1]! } }
}

/** The bench-only tools (noise + the two custom verifications) mounted on every bench stack. */
export function mountBenchTools(ctx: Context): void {
  const tool = (name: string, output: string) => defineTool({
    name,
    description: `bench helper: ${name}`,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
    async execute() { return output },
  })
  ctx.tools.register(tool('bench_noise', 'noise done'))
  ctx.tools.register(tool('bench_lint', 'LINT OK (0 problems)'))
  ctx.tools.register(tool('bench_build', 'BUILD OK'))
}

function noiseCalls(n: number): StreamChunk[][] {
  return Array.from({ length: n }, (_, i) => toolCallResponse(`bn${i}`, 'bench_noise', {}))
}

function verifyCalls(rules: number): StreamChunk[][] {
  const all = [
    testCall('bv1'),
    toolCallResponse('bv2', 'typecheck', {}),
    toolCallResponse('bv3', 'bench_lint', {}),
    toolCallResponse('bv4', 'bench_build', {}),
  ]
  return all.slice(0, rules)
}

function scriptFor(kind: ConstraintCaseKind, rules: number, noise: number, verificationFails: boolean): StreamChunk[][] {
  switch (kind) {
    case 'compliant':
      return [...noiseCalls(noise), editCall(), ...verifyCalls(rules), textResponse('all green, done')]
    case 'violation-missing':
      return [...noiseCalls(noise), editCall(), textResponse('done (forgot the checks)')]
    case 'violation-fail':
      return [...noiseCalls(noise), editCall(), ...verifyCalls(rules).map((call, i) => i === 0 ? testCall('bf0') : call), textResponse('done anyway')]
    case 'no-change':
      return [...noiseCalls(noise), textResponse('just answering')]
  }
}

export interface StackFactoryOptions {
  policy?: PolicyDocument
  maxRemediations?: number
  mountPolicy?: boolean
  sessionId: string
  evidenceRoot?: string
}

async function makeStack(script: StreamChunk[][], opts: StackFactoryOptions) {
  const stack = await buildStack(script, {
    policy: opts.policy ?? policyFor(1),
    maxRemediations: opts.maxRemediations,
    evidenceRoot: opts.evidenceRoot,
  }, opts.mountPolicy ?? true, opts.sessionId)
  mountBenchTools(stack.ctx)
  return stack
}

async function runToEnd(stack: Awaited<ReturnType<typeof buildStack>>, message: string): Promise<void> {
  userSay(stack.agent, message)
  await stack.agent.whenIdle().catch(() => {})
}

function lastEnd(stack: Awaited<ReturnType<typeof buildStack>>): { kind: string; text: string } {
  const last = turnEndPayloads(stack.agent).at(-1)
  return { kind: (last?.reason as { kind?: string } | undefined)?.kind ?? 'none', text: JSON.stringify(last?.reason ?? {}) }
}

/**
 * One constraint-effectiveness case. `verificationFails` flips the shared
 * testSuite fixture so scripted run_tests calls report failure.
 */
export async function runConstraintCase(
  kind: ConstraintCaseKind,
  rules: number,
  noise: number,
  index: number,
): Promise<ConstraintCaseResult> {
  const expectedEnd: 'completed' | 'error' = kind === 'compliant' || kind === 'no-change' ? 'completed' : 'error'
  const stack = await makeStack(scriptFor(kind, rules, noise, false), {
    policy: policyFor(rules),
    maxRemediations: expectedEnd === 'error' ? 0 : 2,
    sessionId: `bench-${kind}-r${rules}-n${noise}-${index}`,
  })
  if (kind === 'violation-fail') stack.testSuite.passing = false

  await runToEnd(stack, 'work the bench scenario')

  const end = lastEnd(stack)
  const actualEnd = end.kind as ConstraintCaseResult['actualEnd']
  const correct = actualEnd === expectedEnd
  const result: ConstraintCaseResult = {
    id: `${kind}-r${rules}-n${noise}-${index}`,
    rules, noise, kind, expectedEnd, actualEnd, correct,
    requests: stack.adapter.requests.length,
  }
  await stack.ctx.fiber.dispose()
  return result
}

/** Remediation-success case: refuse → remediate → pass → complete. */
export async function runRemediationCase(rules: number, index: number): Promise<{ success: boolean; requests: number; expectedRequests: number }> {
  const script: StreamChunk[][] = [
    editCall(),
    ...verifyCalls(rules),
    textResponse('done anyway'),
    ...verifyCalls(rules),
    textResponse('now green'),
  ]
  const stack = await makeStack(script, {
    policy: policyFor(rules),
    maxRemediations: 1,
    sessionId: `bench-remediation-r${rules}-${index}`,
  })
  // The FIRST verification round fails, the post-remediation round passes:
  // flip the shared fixture right after the first run_tests result lands.
  let flipped = false
  stack.ctx.on('tools/post-execute', async (exec, _result, next) => {
    if (!flipped && exec.name === 'run_tests') {
      flipped = true
      stack.testSuite.passing = true
    }
    return next()
  })
  stack.testSuite.passing = false

  await runToEnd(stack, 'change the code')
  const end = lastEnd(stack)
  await stack.ctx.fiber.dispose()
  // edit + r failing verifies + closing + r passing verifies + closing
  return { success: end.kind === 'completed', requests: stack.adapter.requests.length, expectedRequests: 2 * rules + 3 }
}

/** Full constraint matrix sweep. */
export async function runConstraintMatrix(
  rulesList: readonly number[],
  noiseList: readonly number[],
  startIndex = 0,
): Promise<ConstraintCaseResult[]> {
  const results: ConstraintCaseResult[] = []
  for (const rules of rulesList) {
    for (const noise of noiseList) {
      for (const kind of ['compliant', 'violation-missing', 'violation-fail', 'no-change'] as const) {
        results.push(await runConstraintCase(kind, rules, noise, startIndex + results.length))
      }
    }
  }
  return results
}

export function summarizeConstraint(results: readonly ConstraintCaseResult[]): {
  cases: number
  detectionRate: number
  falseBlockRate: number
  falsePassRate: number
  completionCorrectness: number
} {
  const violations = results.filter(r => r.kind === 'violation-missing' || r.kind === 'violation-fail')
  const compliant = results.filter(r => r.kind === 'compliant' || r.kind === 'no-change')
  const detected = violations.filter(r => r.correct).length
  const falseBlocks = compliant.filter(r => !r.correct).length
  return {
    cases: results.length,
    detectionRate: violations.length === 0 ? 1 : detected / violations.length,
    falseBlockRate: compliant.length === 0 ? 0 : falseBlocks / compliant.length,
    falsePassRate: violations.length === 0 ? 0 : (violations.length - detected) / violations.length,
    completionCorrectness: results.filter(r => r.correct).length / results.length,
  }
}

// --- Personalization effectiveness (deterministic proxies) ------------------

export interface PreferenceMatrixCell {
  pref: string
  task: string
  expected: boolean
  actual: boolean
}

export const BENCH_PREFERENCES: ResolvedPreference[] = [
  { id: 'p1', text: 'P1: prefer async/await', appliesTo: { language: 'typescript' }, priority: 50, recency: 1 },
  { id: 'p2', text: 'P2: keep src/** modules small', appliesTo: { fileGlob: ['src/**'] }, priority: 50, recency: 2 },
  { id: 'p3', text: 'P3: explain refactorings step by step', appliesTo: { taskRegex: 'refactor' }, priority: 50, recency: 3 },
  { id: 'p4', text: 'P4: commit early', priority: 50, recency: 4 },
]

export const BENCH_TASKS = [
  { id: 't1', profile: { userMessage: 'implement the handler', recentFiles: ['src/api/user.ts'], recentTools: [] } },
  { id: 't2', profile: { userMessage: 'fix the parser', recentFiles: ['scripts/parse.py'], recentTools: [] } },
  { id: 't3', profile: { userMessage: 'please refactor the auth module', recentFiles: [], recentTools: [] } },
  { id: 't4', profile: { userMessage: 'hello', recentFiles: [], recentTools: [] } },
]

/** Expected relevance by construction (documented, not derived from the code under test). */
export function expectedPreference(prefId: string, taskId: string): boolean {
  if (prefId === 'p4') return true // unconditional
  if (taskId === 't1') return prefId === 'p1' || prefId === 'p2' // ts file under src/
  if (taskId === 't2') return false // python file, no regex hit
  if (taskId === 't3') return prefId === 'p3' // regex hit
  return false
}

export function runPreferenceMatrix(): { cells: PreferenceMatrixCell[]; precision: number; recall: number } {
  const cells: PreferenceMatrixCell[] = []
  let tp = 0, fp = 0, fn = 0
  for (const task of BENCH_TASKS) {
    const bundle = resolveContext({
      taskProfile: task.profile,
      resolution: { rules: [], conflicts: [], monotonicityNotes: [] } as Resolution,
      guards: [],
      preferences: BENCH_PREFERENCES,
    })
    const injected = bundle.sections.find(s => s.order === 920)?.text ?? ''
    for (const pref of BENCH_PREFERENCES) {
      const actual = injected.includes(pref.text)
      const expected = expectedPreference(pref.id, task.id)
      cells.push({ pref: pref.id, task: task.id, expected, actual })
      if (expected && actual) tp++
      else if (!expected && actual) fp++
      else if (expected && !actual) fn++
    }
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  return { cells, precision, recall }
}

/**
 * Reminder-appearance rate: a tool guard must ride EVERY matching accepted
 * tool result into the next request (deterministic delivery proxy for
 * "guard effectiveness" — actual model adherence needs the cloud e2e).
 */
export async function runReminderAppearances(repeats: number, startIndex = 0): Promise<{ rate: number; hits: number }> {
  const guard: BehaviorGuardRule = { id: 'bench-guard', message: 'Check the affected callers.', trigger: { tools: ['edit_file'] } }
  let hits = 0
  for (let i = 0; i < repeats; i++) {
    const stack = await buildStack(
      [editCall(), textResponse('done')],
      { policy: { project: 'bench-pers', policy: { hard: [] } }, guards: [guard] },
      true,
      `bench-reminder-${startIndex + i}`,
    )
    userSay(stack.agent, 'change the code')
    await stack.agent.whenIdle().catch(() => {})
    const second = JSON.stringify(stack.adapter.requests[1]?.messages ?? [])
    if (second.includes('Check the affected callers.')) hits++
    await stack.ctx.fiber.dispose()
  }
  return { rate: hits / repeats, hits }
}

// --- Cost metrics ------------------------------------------------------------

export interface TokenDeltaSample {
  rules: number
  noise: number
  /**
   * Per-REQUEST prompt delta vs the no-plugin baseline (chars/3.5 × 1.15).
   * The runtime-context snapshot rides EVERY request of a turn, so this is
   * the honest per-call overhead metric (a per-turn sum would grow with turn
   * length and misrepresent the overhead).
   */
  deltaTokensPerRequest: number
  /** Request counts for the identical script — the plugin must not add model calls. */
  withRequests: number
  withoutRequests: number
}

async function totalPromptChars(rules: number, noise: number, mountPolicy: boolean, index: number): Promise<{ chars: number; requests: number }> {
  const script = scriptFor('compliant', rules, noise, false)
  const stack = await buildStack(script, {
    policy: policyFor(rules),
  }, mountPolicy, `bench-cost-r${rules}-n${noise}-${mountPolicy}-${index}`)
  mountBenchTools(stack.ctx)
  userSay(stack.agent, 'work the bench scenario')
  await stack.agent.whenIdle().catch(() => {})
  const chars = stack.adapter.requests.reduce((sum, req) => sum + JSON.stringify(req.messages ?? []).length, 0)
  const requests = stack.adapter.requests.length
  await stack.ctx.fiber.dispose()
  return { chars, requests }
}

/** Per-request prompt overhead of the base plugin (hard-rules summary), across the matrix. */
export async function runTokenDeltaMatrix(rulesList: readonly number[], noiseList: readonly number[], startIndex = 0): Promise<TokenDeltaSample[]> {
  const samples: TokenDeltaSample[] = []
  for (const rules of rulesList) {
    for (const noise of noiseList) {
      const withPlugin = await totalPromptChars(rules, noise, true, startIndex + samples.length)
      const without = await totalPromptChars(rules, noise, false, startIndex + samples.length)
      samples.push({
        rules,
        noise,
        deltaTokensPerRequest: Math.round((((withPlugin.chars - without.chars) / withPlugin.requests) / 3.5) * 1.15),
        withRequests: withPlugin.requests,
        withoutRequests: without.requests,
      })
    }
  }
  return samples
}

export interface LayerBreakdownSample { layer: string; deltaTokens: number }

/** Marginal per-turn token cost of each optional layer (r=2, n=0). */
export async function runLayerBreakdown(index = 0): Promise<LayerBreakdownSample[]> {
  const script: StreamChunk[][] = [editCall(), testCall('bl0'), toolCallResponse('bl1', 'typecheck', {}), textResponse('done')]

  async function measure(label: string, extra: Partial<DshPolicyOptions>): Promise<number> {
    const stack = await buildStack(script, { policy: policyFor(2), ...extra }, true, `bench-layer-${label}-${index}`)
    mountBenchTools(stack.ctx)
    userSay(stack.agent, 'work')
    await stack.agent.whenIdle().catch(() => {})
    const chars = JSON.stringify(stack.adapter.requests[0]?.messages ?? []).length
    await stack.ctx.fiber.dispose()
    return Math.round((chars / 3.5) * 1.15)
  }

  const none = await measure('none', {})
  const withGuard = await measure('guard', { guards: [{ id: 'g', message: 'Check the affected callers.', trigger: { always: true } }] })
  const withPref = await measure('pref', { preferences: [{ id: 'p', text: 'Prefer async/await everywhere.', priority: 50, recency: 1 }] })
  const withGoal = await measure('goal', {
    goals: [{ id: 'g1', parentId: null, title: 'Ship v1.0', linkedTaskIds: ['t1'] }],
    taskGoalIds: ['g1'],
  })
  return [
    { layer: 'hard-rules(900)', deltaTokens: none },
    { layer: '+guard(910)', deltaTokens: withGuard - none },
    { layer: '+preference(920)', deltaTokens: withPref - none },
    { layer: '+goal(925)', deltaTokens: withGoal - none },
  ]
}

export interface LatencyStats { meanMs: number; p50Ms: number; p95Ms: number }

export function stats(values: readonly number[]): LatencyStats {
  if (values.length === 0) return { meanMs: 0, p50Ms: 0, p95Ms: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
  return {
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
  }
}
