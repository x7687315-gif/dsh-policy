import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createBehaviorRuntime, detectCorrection, type BehaviorOptions } from '../behavior/wire.ts'
import { ruleSignature, toolDenySignature } from '../behavior/signature.ts'
import {
  alwaysGuards,
  guardContextText,
  guardReminderText,
  liveGuards,
  taskGuardsFor,
  toolGuardsFor,
  type BehaviorGuardRule,
} from '../behavior/guard.ts'
import { evaluatePolicy, type Evaluation, type Violation } from '../engine/constraint-engine.ts'
import { guardsFromUserModel, readUserModelGuardRules } from '../usermodel/guards.ts'
import { preferencesFromUserModel, readUserModelPreferenceRules, type ResolvedPreference } from '../usermodel/preferences.ts'
import { resolveContext, goalContextText } from '../context/resolver.ts'
import { JsonlEvidenceStore } from '../evidence/store.ts'
import type { EvidenceRecorder } from '../evidence/recorder.ts'
import { globalPolicyPath, loadPolicyFile, resolvePolicyPath } from '../policy/loader.ts'
import { resolvePolicies, summarizeRules, validateScopeMonotonicity, type Resolution, type ScopedPolicy } from '../policy/resolver.ts'
export { summarizeRules }
import type { DenyToolsRule, HardRule, PolicyDocument, RuleScope, ToolPassRule } from '../policy/schema.ts'
import { isActive, loadRegistry, projectRegistryPath, type ProjectRegistry } from '../project/registry.ts'
import { readGoals, defaultGoalPath } from '../goal/store.ts'
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
  /**
   * User-confirmed behavior guidance (plan §Phase 8). NON-BLOCKING by type
   * isolation: guards never enter the constraint engine. Stage 12 loads
   * these from the user model; until then they are provided inline.
   */
  guards?: BehaviorGuardRule[]
  /**
   * Read-only path to a durable user model file: enabled behavior-pattern
   * records are projected into guards. The plugin NEVER writes here —
   * mutation goes through the Stage-12 review flow only (plan §2.1).
   */
  userModelPath?: string
  debug?: boolean
  /**
   * User-confirmed soft preferences (plan §Phase 11-12). NON-BLOCKING and
   * type-isolated from hard rules. Mirrors `guards`: inline here OR loaded
   * from the user model via `userModelPath`. Stage 13 injects these at order
   * 920 through the Context Resolver (relevance match + token budget).
   */
  preferences?: ResolvedPreference[]
  /**
   * Context Resolver tuning (Stage 13): token budget ceiling for the injected
   * context bundle (default 800, roadmap §6.2).
   */
  context?: { tokenBudget?: number }
  /**
   * Global-scope hard rules (plan §Phase 13, roadmap §7.1). Optional; when
   * omitted the plugin reads `~/.dsh-policy/policy.json` if present. Global
   * rules apply across all projects and sit BELOW project/task rules in the
   * monotonicity order.
   */
  globalPolicy?: PolicyDocument
  /** Override the global policy file location (default `~/.dsh-policy/policy.json`). */
  globalPolicyPath?: string
  /**
   * Task-scope hard rules (plan §Phase 13, roadmap §7.1): additive-only rules
   * for the current task. A task rule may only ADD requirements — the
   * monotonicity validator rejects any task rule that would weaken a
   * project/global rule (e.g. `enabled: false` same-name override).
   */
  taskRules?: HardRule[]
  /**
   * Project lifecycle (plan §Phase 14): the current project id. When set, the
   * plugin reads `project-registry.json` and excludes the project's rules from
   * resolution unless the project is `active` (paused/completed/archived rules
   * do not leak into the session).
   */
  projectId?: string
  /** Override the project-registry file location (default `~/.dsh-policy/project-registry.json`). */
  projectRegistryPath?: string
  /**
   * Goal model (plan §Phase 15, roadmap §7.3): the read-only goal projection.
   * Inline goals take precedence over `goalPath`. The plugin NEVER writes
   * goals — it only surfaces a linked goal as one line of context.
   */
  goals?: import('../goal/types.ts').GoalNode[]
  /** Load goals from this file (default `~/.dsh-policy/goals.json`). */
  goalPath?: string
  /**
   * Goal ids the CURRENT task explicitly links to. Empty/absent → no goal
   * context is injected (the system does no auto-planning or decomposition).
   */
  taskGoalIds?: string[]
}

/** Session identity of an agent; evidence is correlated per session (plan §Phase 4). */
function sessionIdOf(agent: unknown): string {
  const id = (agent as { session?: { id?: unknown } } | undefined)?.session?.id
  return typeof id === 'string' ? id : 'unknown-session'
}

export interface ProjectPolicyResolution {
  document: PolicyDocument
  source: 'inline' | 'explicit-path' | 'discovered' | 'absent' | 'inactive'
}

/**
 * Project policy resolution with real-environment semantics (Stage 18):
 *  - an explicit inline `policy` or `policyPath` is an assertion — a missing
 *    or corrupt file fails LOUD (loadPolicyFile throws);
 *  - the DEFAULT location (`<cwd>/.dsh-policy/policy.json`) is discovery —
 *    when it does not exist yet the plugin runs with an empty rule set (a
 *    fresh project must not take down the whole Harness session); a CORRUPT
 *    default file still fails loud.
 * Exported for tests; `apply()` uses it with `process.cwd()`.
 */
export function resolveProjectPolicy(
  options: { policy?: PolicyDocument; policyPath?: string; projectId?: string },
  cwd: string,
  projectActive: boolean,
): ProjectPolicyResolution {
  if (!projectActive) {
    return {
      document: { project: options.projectId ?? 'inactive-project', scope: 'project', policy: { hard: [] } },
      source: 'inactive',
    }
  }
  if (options.policy !== undefined) return { document: options.policy, source: 'inline' }
  if (options.policyPath !== undefined) return { document: loadPolicyFile(options.policyPath), source: 'explicit-path' }

  const defaultPath = resolvePolicyPath(cwd)
  if (!existsSync(defaultPath)) {
    return {
      document: { project: 'discovered-project', scope: 'project', policy: { hard: [] } },
      source: 'absent',
    }
  }
  return { document: loadPolicyFile(defaultPath), source: 'discovered' }
}

/**
 * Global policy resolution: global is an OPTIONAL layer — a not-yet-created
 * global file (default location or explicit path) means "no global rules";
 * a corrupt one still fails loud via loadPolicyFile.
 */
export function resolveGlobalPolicy(
  options: { globalPolicy?: PolicyDocument; globalPolicyPath?: string },
): PolicyDocument | undefined {
  if (options.globalPolicy !== undefined) return options.globalPolicy
  const globalFile = options.globalPolicyPath ?? globalPolicyPath()
  return existsSync(globalFile) ? loadPolicyFile(globalFile) : undefined
}

/**
 * Turn-boundary policy evaluation, **fail-closed**.
 *
 * The hard gate must never be lost to an internal exception: if the
 * evaluation itself throws (corrupt evidence store, unexpected error), we
 * refuse the turn — never silently complete it. A throwing evaluation is
 * treated as an unresolved violation, not as a pass.
 */
export function evaluateTurn(resolution: Resolution, evidence: EvidenceRecorder): Evaluation {
  try {
    return evaluatePolicy(resolution, evidence)
  } catch (error) {
    throw new PolicyViolationError([{
      ruleId: 'policy-evaluation',
      requirement: 'hard project policy',
      reason: `policy evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      remediation: 'Check the policy and evidence configuration; the turn was refused rather than silently completed.',
    }])
  }
}

// `summarizeRules` now lives in ../policy/resolver.ts (imported above) so the
// pure Context Resolver can reuse it without a plugin → context layering cycle.

/** Heuristic: does this string look like a file path worth tracking for preference relevance? */
function isPathLike(value: string): boolean {
  return /[/\\]/.test(value) || /\.(ts|tsx|js|jsx|py|go|rs|json|md|css|html|txt|yaml|yml)$/i.test(value)
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
  // --- Scope assembly (plan §Phase 13 + §Phase 14) --------------------------
  // Build the merged policy from three sources, weakest-to-strongest in the
  // monotonicity order global < project < task:
  //   1. global  — `~/.dsh-policy/policy.json` (or inline/path override),
  //                optional, applies across every project.
  //   2. project — the runtime's primary policy, EXCLUDED from resolution when
  //                the project is not `active` in the lifecycle registry.
  //   3. task    — additive-only rules for the current task.
  // A project's rules MUST NOT leak into unrelated work once it is
  // paused/completed/archived (roadmap §7.2).
  let registry: ProjectRegistry | undefined
  let projectActive = true
  if (options.projectId !== undefined) {
    registry = loadRegistry(options.projectRegistryPath ?? projectRegistryPath())
    projectActive = isActive(registry, options.projectId)
  }

  // Project policy resolution. Real-environment semantics (Stage 18):
  //  - an explicit inline `policy` or `policyPath` is an assertion — a missing
  //    or corrupt file fails LOUD;
  //  - the DEFAULT location (`<cwd>/.dsh-policy/policy.json`) is discovery —
  //    when the file does not exist yet the plugin runs with an empty rule
  //    set (a fresh project must not take down the whole Harness session;
  //    a CORRUPT default file still fails loud via loadPolicyFile).
  const projectResolution = resolveProjectPolicy(options, process.cwd(), projectActive)
  const projectDocument: PolicyDocument = projectResolution.document

  const scopedPolicies: ScopedPolicy[] = [
    { scope: options.scope ?? projectDocument.scope ?? 'project', document: projectDocument },
  ]

  // Global rules apply universally — even for an inactive project, global still
  // governs (strongest scope, never weakened by a paused project). See
  // resolveGlobalPolicy: an absent global file means "no global rules".
  const globalDocument = resolveGlobalPolicy(options)
  if (globalDocument !== undefined) {
    scopedPolicies.push({ scope: 'global', document: globalDocument })
  }

  // Task rules: additive-only; the monotonicity validator rejects any task rule
  // that would weaken a project/global rule.
  if (options.taskRules !== undefined && options.taskRules.length > 0) {
    scopedPolicies.push({
      scope: 'task',
      document: { project: `task:${options.projectId ?? 'adhoc'}`, scope: 'task', policy: { hard: options.taskRules } },
    })
  }

  // Fail-fast: reject any scope that attempts to weaken a stronger-scope rule
  // (e.g. a task rule trying to `enabled: false` a global hard rule).
  const monotonicity = validateScopeMonotonicity(scopedPolicies)
  if (!monotonicity.ok) {
    throw new Error(`dsh-policy: constraint monotonicity violated — ${monotonicity.errors.join('; ')}`)
  }

  const resolution = resolvePolicies(scopedPolicies)
  if (resolution.conflicts.length > 0) {
    throw new Error(`dsh-policy: conflicting rule ids in policy: ${[...new Set(resolution.conflicts)].join(', ')}`)
  }

  // Evidence matchers: document config > built-in defaults; rule-level
  // explicit passPattern wins over everything.
  const codeChangeTools = new Set(projectDocument.evidence?.codeChangeTools ?? DEFAULT_CODE_CHANGE_TOOLS)
  const patterns = new Map<string, string>()
  for (const entry of DEFAULT_VERIFICATION_TOOLS) patterns.set(entry.tool, entry.passPattern)
  for (const entry of projectDocument.evidence?.verificationTools ?? []) {
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
  for (const entry of projectDocument.evidence?.verificationTools ?? []) watchTools.add(entry.tool)

  // MUST NOT rules → tool name → rule id. Membership by shape ('denyTools' in
  // rule), not by trigger spelling, so a deny rule is never silently skipped.
  const denied = new Map<string, string>()
  for (const rule of resolution.rules) {
    if ('denyTools' in rule) for (const tool of rule.denyTools) denied.set(tool, rule.id)
  }

  const store = new JsonlEvidenceStore(options.evidenceRoot)
  const behavior = createBehaviorRuntime(options.behavior)
  // User-model guards join inline guards; the model file is read ONCE at
  // activation (restart/HMR re-applies pick up changes — a durable read,
  // matching the file's role as user-controlled durable state).
  const userModelGuards = options.userModelPath !== undefined ? guardsFromUserModel(readUserModelGuardRules(options.userModelPath)) : []
  const guards = liveGuards([...userModelGuards, ...(options.guards ?? [])])
  const userModelPrefs = options.userModelPath !== undefined
    ? preferencesFromUserModel(readUserModelPreferenceRules(options.userModelPath))
    : []
  const preferences = [...userModelPrefs, ...(options.preferences ?? [])]
  // Goal model (roadmap §7.3): read-only projection, the plugin never writes.
  // Inline `goals` wins over `goalPath`; the task links via `taskGoalIds`.
  const goals = options.goals
    ?? (options.goalPath !== undefined ? readGoals(options.goalPath) : readGoals(defaultGoalPath()))
  let lastTaskText = '' // latest user message — the taskRegex channel matches against it
  let recentFiles: string[] = [] // task-profile tracking for preference relevance (language/glob)
  let recentTools: string[] = [] // recent tool names, for potential future tool-based relevance
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
    // Task-profile tracking for the Context Resolver: observe the tools run and
    // the file paths touched (read-only, capped) so preference relevance by
    // language/glob works at runtime, not just in unit tests.
    recentTools.push(exec.name)
    if (recentTools.length > 10) recentTools.shift()
    const args = exec.arguments as Record<string, unknown> | undefined
    if (args !== null && typeof args === 'object') {
      for (const value of Object.values(args)) {
        if (typeof value === 'string' && isPathLike(value)) {
          recentFiles.push(value)
          if (recentFiles.length > 20) recentFiles.shift()
        }
      }
    }
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
        // Defensive: a pattern reaching here should have been validated, but
        // inline `options.policy` bypasses the loader. Never let a bad pattern
        // crash evidence collection — on compile failure, record as not passed
        // (fail-closed: the turn gate will then refuse, never silently pass).
        let passed = true
        if (pattern !== undefined) {
          try {
            passed = new RegExp(pattern).test(text)
          } catch (error) {
            log(`passPattern "${pattern}" failed to compile — recorded as not passed: ${error instanceof Error ? error.message : String(error)}`)
            passed = false
          }
        }
        store.record(sessionId, { kind: 'tool_pass', at: Date.now(), tool: exec.name, passed, detail: text.slice(0, 200) })
        log(`tool_pass recorded via ${exec.name}: ${passed ? 'passed' : 'failed'}`)
      }
    }
    // Behavior-guidance channel (non-blocking): attach a reminder to an
    // accepted result. A guard can only ever ADD context — never deny,
    // never block, never rewrite (type isolation keeps this one-way).
    const decision = await next()
    if (decision.kind === 'accept' && agent !== undefined) {
      const guard = toolGuardsFor(guards, exec.name)[0]
      if (guard !== undefined) {
        log(`guard reminder attached for ${exec.name} (${guard.id})`)
        return {
          ...decision,
          additionalContexts: [
            ...(decision.additionalContexts ?? []),
            createUserMessage({
              content: [{ type: 'text', text: guardReminderText(guard) }],
              source: { kind: 'plugin', plugin: 'dsh-policy' },
            }),
          ],
        }
      }
    }
    return decision
  })

  // Turn-boundary hard gate with remediation loop.
  ctx.on('agent/turn-stopping', (payload) => {
    const { agent, turn } = payload
    const sessionId = sessionIdOf(agent)
    const evaluation = evaluateTurn(resolution, store.recorderFor(sessionId))
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
    if (event.type !== 'user/message') return
    const message = event.data as { source?: { kind?: string }; content?: { type: string; text?: string }[] }
    if (message.source?.kind !== 'user') return
    const text = (message.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join(' ')
    lastTaskText = text // taskRegex guard channel matches against the latest user message
    if (behavior === undefined) return
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
    // Guidance layer: order 910 renders AFTER hard rules (900) — physical
    // prompt order mirrors the layer hierarchy. Dynamic text: re-evaluated
    // per assembly against the latest task text.
    const disposeGuards = root.systemPrompt?.context({
      name: 'dsh-policy/guards',
      order: 910,
      text: () => guardContextText([...alwaysGuards(guards), ...taskGuardsFor(guards, lastTaskText)]),
    })
    if (disposeGuards !== undefined) ctx.effect(() => disposeGuards)
    // Preference layer (order 920): the LAST layer physically, so soft guidance
    // can never sit above hard rules (900) or guards (910). Dynamic text is
    // re-evaluated per assembly against the latest task profile, and it draws
    // from the same Context Resolver the unit tests exercise.
    const disposePrefs = root.systemPrompt?.context({
      name: 'dsh-policy/preferences',
      order: 920,
      text: () => {
        const bundle = resolveContext({
          taskProfile: { userMessage: lastTaskText, recentFiles, recentTools },
          resolution,
          guards,
          preferences,
          tokenBudget: options.context?.tokenBudget,
        })
        return bundle.sections.find(section => section.order === 920)?.text ?? ''
      },
    })
    if (disposePrefs !== undefined) ctx.effect(() => disposePrefs)
    // Goal context (roadmap §7.3): one line, only when the task explicitly
    // links to a goal. Re-evaluated per assembly so a re-applied plugin with a
    // different task linkage re-surfaces the right line. Shares the resolver's
    // `goalContextText` so the bundle and the live injection stay identical.
    const disposeGoal = root.systemPrompt?.context({
      name: 'dsh-policy/goal',
      order: 925,
      text: () => goalContextText(goals, options.taskGoalIds),
    })
    if (disposeGoal !== undefined) ctx.effect(() => disposeGoal)
  } catch (error) {
    log(`system-prompt context registration skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Object form for `ctx.plugin(dshPolicy, options)`; named exports serve the Cordis loader. */
export const dshPolicy = { name, inject, apply }
