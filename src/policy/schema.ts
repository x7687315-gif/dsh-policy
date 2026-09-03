/**
 * v1 hard-rule model — generalized from the v0 POC while staying pure data
 * (plan §11.5, §Phase 3). Two rule kinds exist:
 *
 * - `ToolPassRule`  — "after X, tool Y must pass": armed by a trigger
 *                     (v1: `code_change`), verified from recorded evidence.
 * - `DenyToolsRule` — "MUST NOT call these tools": enforced at
 *                     `tools/pre-execute` as a hard gate.
 *
 * Rules carry scope and activation so that scope resolution can guarantee
 * Constraint Monotonicity (plan §2.5): specific scopes may ADD hard rules,
 * never silently weaken stronger ones.
 */
export type RuleScope = 'global' | 'project' | 'task'

/** Scope strength for monotonicity: lower rank = stronger, wins on conflict. */
export const SCOPE_RANK: Record<RuleScope, number> = { global: 0, project: 1, task: 2 }

/** Built-in requirement names mapped to their default verification tool. */
export const DEFAULT_REQUIRE_TOOL: Record<string, string> = {
  tests_pass: 'run_tests',
  typecheck_pass: 'typecheck',
}

export interface ToolPassRule {
  id: string
  trigger: 'code_change'
  /**
   * Built-in name (`tests_pass` / `typecheck_pass`) or an explicit
   * `{ kind: 'tool_pass', tool, passPattern? }` requirement.
   */
  require: string | { kind: 'tool_pass'; tool: string; passPattern?: string }
  enforcement: 'hard'
  /** Deactivated rules are skipped by both the resolver and the engine. */
  enabled?: boolean
  /** Model-visible instruction injected when this rule blocks completion. */
  remediation?: string
}

export interface DenyToolsRule {
  id: string
  trigger: 'always'
  /** Tool names the agent MUST NOT call; attempted calls are denied. */
  denyTools: string[]
  enforcement: 'hard'
  enabled?: boolean
  remediation?: string
}

export type HardRule = ToolPassRule | DenyToolsRule

/** Evidence matchers may be configured per project instead of hard-coded. */
export interface EvidenceConfig {
  codeChangeTools?: string[]
  verificationTools?: { tool: string; passPattern?: string }[]
}

export interface PolicyDocument {
  project: string
  /** Scope this document contributes rules to (default `project`). */
  scope?: RuleScope
  evidence?: EvidenceConfig
  policy: {
    hard: HardRule[]
  }
}

export const DEFAULT_REMEDIATION =
  'Hard project policy violated: tests must pass after code changes. ' +
  'Run the test suite now and make it pass before finishing.'

export const DEFAULT_CODE_CHANGE_TOOLS = ['edit_file', 'write_file', 'apply_patch']

export const DEFAULT_VERIFICATION_TOOLS: { tool: string; passPattern: string }[] = [
  { tool: 'run_tests', passPattern: '\\bPASSED\\b' },
  { tool: 'typecheck', passPattern: '\\bNO ISSUES\\b' },
]

/** Resolve the verification tool a pass-rule requires. */
export function requireTool(rule: ToolPassRule): string {
  return typeof rule.require === 'string'
    ? DEFAULT_REQUIRE_TOOL[rule.require] ?? 'run_tests'
    : rule.require.tool
}
