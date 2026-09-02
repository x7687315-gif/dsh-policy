import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { evaluatePolicy, type Violation } from '../engine/constraint-engine.ts'
import { EvidenceRecorder } from '../evidence/recorder.ts'
import { loadPolicyFile, resolvePolicyPath } from '../policy/loader.ts'
import type { PolicyDocument } from '../policy/schema.ts'

export const name = 'dsh-policy'
export const inject: string[] = []

/**
 * Thrown at the `agent/turn-stopping` checkpoint when hard constraints stay
 * violated after the remediation budget is exhausted. The agent loop turns
 * this into a failed turn — completion is refused, never faked.
 */
export class PolicyViolationError extends Error {
  constructor(readonly violations: readonly Violation[]) {
    super(
      `dsh-policy: turn blocked by hard project policy [${violations.map(v => v.ruleId).join(', ')}]`,
    )
    this.name = 'PolicyViolationError'
  }
}

export interface TestRunToolMatcher {
  /** Harness tool name that runs a test suite. */
  name: string
  /** Regex tested against the tool's result value to decide `passed`. */
  passPattern: string
}

export interface DshPolicyOptions {
  /** Inline policy document (takes precedence over `policyPath`). */
  policy?: PolicyDocument
  /** Explicit policy file location; defaults to `<cwd>/.dsh-policy/policy.json`. */
  policyPath?: string
  /**
   * How often the plugin re-injects a remediation instruction at the
   * turn-stopping checkpoint before refusing the turn outright (default 2).
   */
  maxRemediations?: number
  /** Tools whose execution counts as a code change. */
  codeChangeTools?: string[]
  /** Tools whose execution counts as a test run, with their pass pattern. */
  testRunTools?: TestRunToolMatcher[]
  debug?: boolean
}

const DEFAULT_CODE_CHANGE_TOOLS = ['edit_file', 'write_file', 'apply_patch']
const DEFAULT_TEST_RUN_TOOLS: TestRunToolMatcher[] = [
  { name: 'run_tests', passPattern: '\\bPASSED\\b' },
]

function recorderFor(agent: object, store: WeakMap<object, EvidenceRecorder>): EvidenceRecorder {
  let recorder = store.get(agent)
  if (recorder === undefined) {
    recorder = new EvidenceRecorder()
    store.set(agent, recorder)
  }
  return recorder
}

function remediationMessage(violations: readonly Violation[]): UserMessage {
  const text = ['[dsh-policy] Hard project policy requires your attention:', ...violations.map(v => `- ${v.reason}\n  ${v.remediation}`)].join('\n')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-policy' },
  })
}

/**
 * dsh-policy runtime (Stage 3 wiring).
 *
 * Enforcement seams (verified against DeepSeek Harness):
 * - `tools/post-execute` (waterfall): observe real tool results → normalized
 *   evidence. Runtime truth beats model claims.
 * - `agent/turn-stopping` (serial checkpoint): evaluate hard constraints.
 *   While violated and within the remediation budget, inject a remediation
 *   user message — the loop re-opens the turn (verified: the checkpoint re-reads
 *   the inbox, a spliced message forces another step). Beyond the budget,
 *   throw so the turn can only end as an error, never as a silent completion.
 */
export function apply(ctx: Context, options: DshPolicyOptions = {}): void {
  const policy: PolicyDocument = options.policy
    ?? loadPolicyFile(options.policyPath ?? resolvePolicyPath())

  const codeChangeTools = new Set(options.codeChangeTools ?? DEFAULT_CODE_CHANGE_TOOLS)
  const testRunTools = options.testRunTools ?? DEFAULT_TEST_RUN_TOOLS
  const maxRemediations = options.maxRemediations ?? 2

  const recorders = new WeakMap<object, EvidenceRecorder>()
  const remediationsUsed = new WeakMap<object, number>()
  const log = (message: string): void => {
    if (options.debug === true) ctx.logger?.info(`[dsh-policy] ${message}`)
  }

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const agent = exec.agent
    if (agent !== undefined) {
      const recorder = recorderFor(agent, recorders)
      if (codeChangeTools.has(exec.name)) {
        recorder.record({
          kind: 'code_change',
          at: Date.now(),
          tool: exec.name,
          detail: JSON.stringify(exec.arguments ?? null).slice(0, 200),
        })
        log(`code_change recorded via ${exec.name}`)
      }
      const matcher = testRunTools.find(tool => tool.name === exec.name)
      if (matcher !== undefined && !result.isError) {
        const text = typeof result.value === 'string'
          ? result.value
          : JSON.stringify(result.value ?? result.content)
        const passed = new RegExp(matcher.passPattern).test(text)
        recorder.record({ kind: 'test_run', at: Date.now(), tool: exec.name, passed, detail: text.slice(0, 200) })
        log(`test_run recorded via ${exec.name}: ${passed ? 'passed' : 'failed'}`)
      }
    }
    return next()
  })

  ctx.on('agent/turn-stopping', (payload) => {
    const { agent } = payload
    const evaluation = evaluatePolicy(policy, recorderFor(agent, recorders))
    if (evaluation.status === 'PASS') return

    const used = remediationsUsed.get(agent) ?? 0
    if (used < maxRemediations) {
      remediationsUsed.set(agent, used + 1)
      log(`block: ${evaluation.violations.map(v => v.ruleId).join(', ')} → remediation ${used + 1}/${maxRemediations}`)
      agent.inject(remediationMessage(evaluation.violations))
      return
    }

    log(`block: remediation budget exhausted → refusing completion`)
    throw new PolicyViolationError(evaluation.violations)
  })
}

/** Object form for `ctx.plugin(dshPolicy, options)`; named exports serve the Cordis loader. */
export const dshPolicy = { name, inject, apply }
