/**
 * v0 hard-rule schema — the smallest data model that can express the POC rule
 * `code_change → tests_pass` (project plan §5, §Phase 2).
 *
 * Rules are pure data (plan §11.5): the engine evaluates policy documents,
 * it does not contain project-specific branches.
 */
export type HardTrigger = 'code_change'
export type HardRequirement = 'tests_pass'

export interface HardRule {
  /** Stable, unique rule identifier (used in violation reports and tests). */
  id: string
  /** What runtime fact arms this rule. */
  trigger: HardTrigger
  /** What must be verifiably true once the trigger fired. */
  require: HardRequirement
  /** Only `hard` rules exist in layer 1; the value is explicit for auditability. */
  enforcement: 'hard'
  /** Model-visible instruction injected when this rule blocks completion. */
  remediation?: string
}

export interface PolicyDocument {
  project: string
  policy: {
    hard: HardRule[]
  }
}

export const DEFAULT_REMEDIATION =
  'Hard project policy violated: tests must pass after code changes. ' +
  'Run the test suite now and make it pass before finishing.'
