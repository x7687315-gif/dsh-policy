/**
 * Stage 16 benchmark runner (plan §Phase 18, roadmap §9).
 *
 * Deterministic replay over the REAL Harness stack (ScriptedAdapter is the
 * only mock — zero local inference). Writes `bench/report.json` and prints a
 * summary. The headline rates are PINNED by `tests/integration/bench.test.ts`
 * so they cannot silently regress; latency numbers are environment-dependent
 * and reported, never asserted.
 *
 * Run with: pnpm bench
 */
import { performance } from 'node:perf_hooks'
import { statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform, versions } from 'node:process'
import {
  runConstraintMatrix,
  runRemediationCase,
  summarizeConstraint,
  runPreferenceMatrix,
  runReminderAppearances,
  runTokenDeltaMatrix,
  runLayerBreakdown,
  stats,
} from './matrix.ts'
import { userSay } from '../tests/integration/stack.ts'
import { EvidenceRecorder } from '../src/evidence/recorder.ts'
import { evaluateTurn } from '../src/plugin/index.ts'
import type { Resolution } from '../src/policy/resolver.ts'
import type { PolicyEvent } from '../src/evidence/events.ts'
import { JsonlEvidenceStore } from '../src/evidence/store.ts'

const RULES = [1, 2, 4]
const NOISE = [0, 3, 8]

console.log('=== dsh-policy Stage 16 benchmark ===')
console.log(`rules=${RULES.join('/')} noise=${NOISE.join('/')} — real loop, scripted adapter\n`)

// --- 1. Constraint effectiveness -------------------------------------------
const matrix = await runConstraintMatrix(RULES, NOISE)
const constraint = summarizeConstraint(matrix)

const remediations = []
for (let i = 0; i < RULES.length; i++) remediations.push(await runRemediationCase(RULES[i]!, i))
const remediationSuccessRate = remediations.filter(r => r.success).length / remediations.length

console.log(`constraint: ${constraint.cases} cases — detection ${(constraint.detectionRate * 100).toFixed(1)}%, falseBlock ${(constraint.falseBlockRate * 100).toFixed(1)}%, falsePass ${(constraint.falsePassRate * 100).toFixed(1)}%, remediation ${(remediationSuccessRate * 100).toFixed(1)}%`)

// --- 2. Personalization effectiveness (deterministic proxies) ---------------
const prefMatrix = runPreferenceMatrix()
const reminders = await runReminderAppearances(5, 500)
console.log(`personalization: preference precision ${(prefMatrix.precision * 100).toFixed(1)}% / recall ${(prefMatrix.recall * 100).toFixed(1)}%; reminder delivery ${(reminders.rate * 100).toFixed(1)}%`)

// --- 3. Cost ----------------------------------------------------------------
const tokenDeltas = await runTokenDeltaMatrix(RULES, NOISE)
const deltaValues = tokenDeltas.map(s => s.deltaTokensPerRequest)
const layerBreakdown = await runLayerBreakdown(900)

// Hook latency: end-to-end wall clock of identical scripted turns with vs
// without the plugin (the delta IS the per-turn overhead a user observes).
async function timedTurns(mountPolicy: boolean, runs: number, startIndex: number): Promise<number[]> {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const { buildStack } = await import('../tests/integration/stack.ts')
    const { editCall, testCall } = await import('../tests/integration/stack.ts')
    const { toolCallResponse, textResponse } = await import('../tests/integration/mock-adapter.ts')
    const stack = await buildStack(
      [editCall(), testCall(`lt${i}`), toolCallResponse(`lt2${i}`, 'typecheck', {}), textResponse('done')],
      { policy: { project: 'bench-latency', policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }, { id: 'typecheck-required', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' }] } } },
      mountPolicy,
      `bench-latency-${mountPolicy}-${startIndex + i}`,
    )
    const t0 = performance.now()
    userSay(stack.agent, 'work')
    await stack.agent.whenIdle().catch(() => {})
    times.push(performance.now() - t0)
    await stack.ctx.fiber.dispose()
  }
  return times
}

const withPluginTimes = await timedTurns(true, 20, 600)
const withoutPluginTimes = await timedTurns(false, 20, 600)
const deltaTimes = withPluginTimes.map((t, i) => t - withoutPluginTimes[i]!)
const hookLatency = stats(deltaTimes)

// Micro-benchmarks: pure evaluation + evidence append.
const resolution: Resolution = {
  rules: [
    { id: 'r1', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' },
    { id: 'r2', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' },
  ],
  conflicts: [],
  monotonicityNotes: [],
}
const recorder = new EvidenceRecorder()
const events: PolicyEvent[] = []
for (let i = 0; i < 100; i++) {
  events.push({ kind: 'code_change', at: i * 10, tool: 'edit_file', detail: '' })
  events.push({ kind: 'tool_pass', at: i * 10 + 5, tool: 'run_tests', passed: true, detail: '' })
}
for (const event of events) recorder.record(event)
const evalStart = performance.now()
const EVALS = 5000
for (let i = 0; i < EVALS; i++) evaluateTurn(resolution, recorder)
const evalUsPerCall = ((performance.now() - evalStart) / EVALS) * 1000

const evidenceDir = mkdtempSync(join(tmpdir(), 'dsh-bench-evidence-'))
let appendMs = 0
let fileBytes = 0
try {
  const store = new JsonlEvidenceStore(evidenceDir)
  const APPENDS = 500
  const t0 = performance.now()
  for (let i = 0; i < APPENDS; i++) store.record('bench-storage', { kind: 'tool_pass', at: i, tool: 'run_tests', passed: true, detail: 'x'.repeat(80) })
  appendMs = (performance.now() - t0) / APPENDS
  fileBytes = statSync(join(evidenceDir, 'bench-storage.jsonl')).size
} finally {
  rmSync(evidenceDir, { recursive: true, force: true })
}

// Extra LLM calls on compliant/no-change turns: the plugin must add ZERO
// model calls — compare request counts for the identical scripted turns.
const compliantCases = matrix.filter(r => r.kind === 'compliant' || r.kind === 'no-change')
const requestBaseByCell = new Map(tokenDeltas.map(s => [`${s.rules}-${s.noise}`, s]))
const extraLlmCalls = compliantCases.map(caseItem => {
  const base = requestBaseByCell.get(`${caseItem.rules}-${caseItem.noise}`)
  return base === undefined ? 0 : caseItem.requests - base.withRequests
})
const maxExtraLlmCalls = Math.max(...extraLlmCalls, 0)

const report = {
  meta: {
    timestamp: new Date().toISOString(),
    node: versions.node,
    platform,
    rules: RULES,
    noise: NOISE,
    note: 'latency values are environment-dependent; rates are deterministic and pinned by tests/integration/bench.test.ts',
  },
  constraint: {
    ...constraint,
    remediationSuccessRate,
    perCase: matrix,
  },
  personalization: {
    preferencePrecision: prefMatrix.precision,
    preferenceRecall: prefMatrix.recall,
    matrix: prefMatrix.cells,
    reminderDeliveryRate: reminders.rate,
    modelAdherenceNote:
      'Model adherence (does the model FOLLOW reminders/preferences) is not measurable with a scripted adapter; it requires the deferred cloud e2e. What is pinned here is mechanism delivery, relevance precision/recall, and persistence.',
    candidateNote: 'Accept→persist and reject→no-revival are pinned by the Stage 10/12 suites (see docs/benchmarks.md).',
  },
  cost: {
    tokenDeltaPerRequest: { samples: tokenDeltas, ...stats(deltaValues) },
    layerBreakdown,
    hookLatencyDeltaMs: hookLatency,
    evaluateTurnMicroUsPerEval: Math.round(evalUsPerCall * 1000) / 1000,
    evidenceAppendMsPerRecord: Math.round(appendMs * 1000) / 1000,
    evidenceBytesPerSession: fileBytes,
    extraLlmCallsOnCompliantTurns: maxExtraLlmCalls,
  },
}

writeFileSync('bench/report.json', `${JSON.stringify(report, null, 2)}\n`)
console.log(`cost: prompt Δ/request mean=${report.cost.tokenDeltaPerRequest.meanMs.toFixed(0)} p50=${report.cost.tokenDeltaPerRequest.p50Ms} p95=${report.cost.tokenDeltaPerRequest.p95Ms} tokens; hook wall-clock Δ p50=${hookLatency.p50Ms.toFixed(2)}ms p95=${hookLatency.p95Ms.toFixed(2)}ms`)
console.log(`micro: evaluateTurn ${report.cost.evaluateTurnMicroUsPerEval}µs/eval, evidence append ${report.cost.evidenceAppendMsPerRecord}ms/record (${report.cost.evidenceBytesPerSession}B/session file)`)
console.log(`zero-extra-calls check: max extra model calls on compliant turns = ${maxExtraLlmCalls}`)
console.log('\nreport written to bench/report.json')

