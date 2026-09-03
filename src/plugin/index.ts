import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createBehaviorRuntime, detectCorrection, type BehaviorOptions } from '../behavior/wire.ts'
import { ruleSignature, toolDenySignature } from '../behavior/signature.ts'
import { evaluatePolicy, type Violation } from '../engine/constraint-engine.ts'
import { JsonlEvidenceStore } from '../evidence/store.ts'
import { loadPolicyFile, resolvePolicyPath } from '../policy/loader.ts'
import { resolvePolicies, type Resolution, type ScopedPolicy } from '../policy/resolver.ts'
import type { DenyToolsRule, PolicyDocument, RuleScope, ToolPassRule } from '../policy/schema.ts'
import {
  DEFAULT_CODE_CHANGE_TOOLS,
  DEFAULT_VERIFICATION_TOOLS,
  requireTool,
} from '../policy/schema.ts'

export const name = 'dsh-policy'
// Activation waits for the system-prompt service: registering the rule
// summary is not optional — a plugin that runs without it would enforce
// rules the model has never been told about.
export const inject = ['systemPrompt']

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

export interface DshPolicyOptions {
  /** Inline policy document (takes precedence over `policyPath`). */
  policy?: PolicyDocument
  /** Explicit policy file location; defaults to `<cwd>/.dsh-policy/policy.json`. */
  policyPath?: string
  /** Scope attributed to the single document provided via options (default `project`). */
  scope?: RuleScope
  /**
   * How often the plugin re-injects a remediation instruction at the
   * turn-stopping checkpoint before refusing the turn outright (default 2).
   */
  maxRemediations?: number
  /**
   * Directory for durable session evidence (JSONL, one file per session).
   * Undefined (default) keeps evidence in memory only. Persisted evidence is
   * re-hydrated when a session resumes, so an unremediated violation survives
   * a process restart.
   */
  evidenceRoot?: string
  /**
   * Behavior observation (plan §Phase 7): deterministic, zero-extra-LLM-call
   * pattern detection over this plugin's own enforcement actions plus a
   * low-precision user-correction heuristic. Opt-in; candidates land in
   * `behavior.root` for the Stage-12 review flow — never in user state.
   */
  behavior?: BehaviorOptions
  debug?: boolean
}

/** Session identity of an agent; evidence is correlated per session (plan §Phase 4). */
function sessionIdOf(agent: unknown): string {
  const id = (agent as { session?: { id?: unknown } } | undefined)?.session?.id
  return typeof id === 'string' ? id : 'unknown-session'
}

export function summarizeRules(resolution: Resolution): string {
  const lines: string[] = ['[dsh-policy] Active hard project rules (runtime-enforced, not optional):']
  for (const rule of resolution.rules) {
    if ('denyTools' in rule) {
      lines.push(`- ${rule.id}: MUST NOT call tools [${rule.denyTools.join(', ')}]`)
    } else {
      const requirement = typeof rule.require === 'string' ? rule.require : `a passing "${rule.require.tool}" run`
      lines.push(`- ${rule.id}: after code changes, ${requirement} must hold (verified from real tool results, not from your claims)`)
    }
  }
  return lines.join('\n')
}

function remediationMessage(violations: readonly Violation[]): UserMessage {
  const text = ['[dsh-policy] Hard project policy requires your attention:', ...violations.map(v => `- ${v.reason}\n  ${v.remediation}`)].join('\n')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-policy' },
  })
}

/**
 * dsh-policy runtime, v1.
 *
 * Enforcement seams (verified against DeepSeek Harness, see docs/architecture.md):
 * - `tools/pre-execute` (waterfall): MUST NOT rules deny the call outright —
 *   the tool body never runs.
 * - `tools/post-execute` (waterfall): observe real tool results → normalized
 *   evidence. Runtime truth beats model claims.
 * - `agent/turn-stopping` (serial checkpoint): evaluate pass-rules. While
 *   violated and within the remediation budget, inject a remediation user
 *   message — the loop re-opens the turn. Beyond the budget, throw so the
 *   turn can only end as an error, never as a silent completion.
 * - `ctx.systemPrompt.context()`: the model is TOLD the rules (explanation);
 *   the runtime enforces them independently (plan §11.3).
 */
export function apply(ctx: Context, options: DshPolicyOptions = {}): void {
  const document: PolicyDocument = options.policy
    ?? loadPolicyFile(options.policyPath ?? resolvePolicyPath())

  const resolution = resolvePolicies([
    { scope: options.scope ?? document.scope ?? 'project', document },
  ])
  if (resolution.conflicts.length > 0) {
    throw new Error(`dsh-policy: conflicting rule ids in policy: ${[...new Set(resolution.conflicts)].join(', ')}`)
  }

  // Evidence matchers: document config > built-in defaults; rule-level
  // explicit passPattern wins over everything.
  const codeChangeTools = new Set(document.evidence?.codeChangeTools ?? DEFAULT_CODE_CHANGE_TOOLS)
  const patterns = new Map<string, string>()
  for (const entry of DEFAULT_VERIFICATION_TOOLS) patterns.set(entry.tool, entry.passPattern)
  for (const entry of document.evidence?.verificationTools ?? []) {
    if (entry.passPattern !== undefined) patterns.set(entry.tool, entry.passPattern)
  }
  for (const rule of resolution.rules) {
    if (rule.trigger === 'code_change' && typeof rule.require !== 'string' && rule.require.passPattern !== undefined) {
      patterns.set(requireTool(rule), rule.require.passPattern)
    }
  }
  // Which verification tools to watch at all: those the rules require, plus
  // any explicitly configured ones.
  const watchTools = new Set<string>()
  for (const rule of resolution.rules) {
    if (rule.trigger === 'code_change') watchTools.add(requireTool(rule as ToolPassRule))
  }
  for (const entry of document.evidence?.verificationTools ?? []) watchTools.add(entry.tool)

  // MUST NOT rules → tool name → rule id. Membership by shape ('denyTools' in
  // rule), not by trigger spelling, so a deny rule is never silently skipped.
  const denied = new Map<string, string>()
  for (const rule of resolution.rules) {
    if ('denyTools' in rule) for (const tool of rule.denyTools) denied.set(tool, rule.id)
  }

  const store = new JsonlEvidenceStore(options.evidenceRoot)
  const behavior = createBehaviorRuntime(options.behavior)
  // Remediation budget is PER TURN (keyed by the turn-stopping payload's turn
  // number): one exhausting turn must not strip later turns of their
  // remediation chances.
  const remediationsUsed = new WeakMap<object, Map<number, number>>()
  const log = (message: string): void => {
    if (options.debug === true) ctx.logger?.info(`[dsh-policy] ${message}`)
  }

  // Hard MUST NOT gate: deny before the tool body can run.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const ruleId = denied.get(exec.name)
    if (ruleId !== undefined) {
      const agent = exec.agent
      if (agent !== undefined) {
        const sessionId = sessionIdOf(agent)
        store.record(sessionId, { kind: 'tool_denied', at: Date.now(), tool: exec.name, ruleId })
        behavior?.note({
          kind: 'tool_denied_repeated',
          signature: toolDenySignature(exec.name),
          sessionId,
          at: Date.now(),
          detail: `denied by ${ruleId}`,
        })
      }
      log(`denied ${exec.name} by ${ruleId}`)
      const rule = resolution.rules.find(candidate => candidate.id === ruleId) as DenyToolsRule | undefined
      return { kind: 'deny', reason: rule?.remediation ?? `Denied by hard project policy "${ruleId}": ${exec.name} is a forbidden tool.` }
    }
    return next()
  })

  // Evidence collection from real results.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const agent = exec.agent
    if (agent !== undefined) {
      const sessionId = sessionIdOf(agent)
      if (codeChangeTools.has(exec.name)) {
        store.record(sessionId, {
          kind: 'code_change',
          at: Date.now(),
          tool: exec.name,
          detail: JSON.stringify(exec.arguments ?? null).slice(0, 200),
        })
        log(`code_change recorded via ${exec.name}`)
      }
      if (watchTools.has(exec.name) && !result.isError) {
        const pattern = patterns.get(exec.name)
        const text = typeof result.value === 'string'
          ? result.value
          : JSON.stringify(result.value ?? result.content)
        const passed = pattern === undefined ? true : new RegExp(pattern).test(text)
        store.record(sessionId, { kind: 'tool_pass', at: Date.now(), tool: exec.name, passed, detail: text.slice(0, 200) })
        log(`tool_pass recorded via ${exec.name}: ${passed ? 'passed' : 'failed'}`)
      }
    }
    return next()
  })

  // Turn-boundary hard gate with remediation loop.
  ctx.on('agent/turn-stopping', (payload) => {
    const { agent, turn } = payload
    const sessionId = sessionIdOf(agent)
    const evaluation = evaluatePolicy(resolution, store.recorderFor(sessionId))
    if (evaluation.status === 'PASS') return

    const budget = options.maxRemediations ?? 2
    const perTurn = remediationsUsed.get(agent) ?? new Map<number, number>()
    const used = perTurn.get(turn) ?? 0
    if (used < budget) {
      perTurn.set(turn, used + 1)
      remediationsUsed.set(agent, perTurn)
      log(`block: ${evaluation.violations.map(v => v.ruleId).join(', ')} → remediation ${used + 1}/${budget} (turn ${turn})`)
      for (const violation of evaluation.violations) {
        behavior?.note({
          kind: 'remediation_repeated',
          signature: ruleSignature('remediation_repeated', violation.ruleId),
          sessionId,
          at: Date.now(),
          detail: violation.reason,
        })
      }
      agent.inject(remediationMessage(evaluation.violations))
      return
    }

    log(`block: remediation budget exhausted (turn ${turn}) → refusing completion`)
    for (const violation of evaluation.violations) {
      behavior?.note({
        kind: 'hard_block_repeated',
        signature: ruleSignature('hard_block_repeated', violation.ruleId),
        sessionId,
        at: Date.now(),
        detail: violation.reason,
      })
    }
    throw new PolicyViolationError(evaluation.violations)
  })

  // Behavior observation: user-correction heuristic over the session firehose.
  // Low precision BY DESIGN — it can only ever produce a candidate for the
  // user to review, never durable state (plan §Phase 7 boundary).
  ctx.on('session/event', (session, event) => {
    if (behavior === undefined || event.type !== 'user/message') return
    const message = event.data as { source?: { kind?: string }; content?: { type: string; text?: string }[] }
    if (message.source?.kind !== 'user') return
    const text = (message.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join(' ')
    const signature = detectCorrection(text, options.behavior)
    if (signature === undefined) return
    behavior.note({
      kind: 'user_correction',
      signature,
      sessionId: typeof session.id === 'string' ? session.id : 'unknown-session',
      at: Date.now(),
      detail: 'short corrective user message',
    })
  })

  // The model is told the rules; the runtime enforces them independently.
  // Registered on the ROOT scope: the agent loop assembles prompts from its
  // own scope chain, and plugin fibers are siblings of the loop fiber — a
  // plugin-scope registration would be invisible to every assembly.
  // The disposer is tied to THIS plugin fiber via ctx.effect: on dispose the
  // rule text is unregistered, so a re-applied plugin never leaves stale
  // policy text in the prompt (explanation must track enforcement, §11.3).
  try {
    const root: Context = ctx.root
    const dispose = root.systemPrompt?.context({
      name: 'dsh-policy',
      order: 900,
      text: summarizeRules(resolution),
    })
    if (dispose !== undefined) ctx.effect(() => dispose)
  } catch (error) {
    log(`system-prompt context registration skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Object form for `ctx.plugin(dshPolicy, options)`; named exports serve the Cordis loader. */
export const dshPolicy = { name, inject, apply }
