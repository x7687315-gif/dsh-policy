import type { HardRule, PolicyDocument, RuleScope, ToolPassRule } from './schema.ts'
import { requireTool, SCOPE_RANK } from './schema.ts'

export interface ScopedPolicy {
  scope: RuleScope
  document: PolicyDocument
}

export interface Resolution {
  /** Active rules, stronger scopes first. Deactivated rules are excluded. */
  rules: HardRule[]
  /** Rule ids declared in more than one scope. */
  conflicts: string[]
  /**
   * Human-readable notes about specificity attempts that would have weakened
   * a stronger scope — kept (stronger scope wins), never applied.
   */
  monotonicityNotes: string[]
}

/**
 * Merge scoped policy documents into one active rule set.
 *
 * Constraint Monotonicity (plan §2.5): a more specific scope may ADD rules,
 * but cannot weaken a stronger scope — a rule id declared twice keeps the
 * stronger scope's version and the conflict is reported loudly.
 */
export function resolvePolicies(policies: ScopedPolicy[]): Resolution {
  const ordered = [...policies].sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope])

  const rules: HardRule[] = []
  const owner = new Map<string, RuleScope>()
  const conflicts: string[] = []
  const monotonicityNotes: string[] = []

  for (const { scope, document } of ordered) {
    for (const rule of document.policy.hard) {
      if (rule.enabled === false) continue
      const previous = owner.get(rule.id)
      if (previous !== undefined) {
        conflicts.push(rule.id)
        monotonicityNotes.push(
          `rule "${rule.id}" declared in ${previous} and ${scope}; the ${previous} version is kept ` +
          `(a specific scope may add hard rules but never weakens a stronger scope)`,
        )
        continue
      }
      owner.set(rule.id, scope)
      rules.push(rule)
    }
  }

  return { rules, conflicts, monotonicityNotes }
}

/**
 * Human-readable hard-rule summary injected into the model prompt (order 900).
 * Moved here from the plugin entry so the pure Context Resolver can reuse it
 * without creating a `context → plugin` layering cycle.
 */
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

/**
 * Scope-monotonicity validation (plan §2.5, roadmap §7.1): the upgrade from
 * resolution-time "keep the stronger scope" to **validation-time rejection of
 * weakening declarations**.
 *
 * `resolvePolicies` still keeps the stronger scope on an id collision and only
 * notes it (so identical cross-scope duplication is harmless). This pass runs
 * *before* resolution and fails loudly when a weaker scope (project/task)
 * attempts to weaken a rule owned by a stronger scope:
 *
 *  - `enabled: false` on a stronger-scope rule id → rejection (a specific scope
 *    may not disable a global/project hard rule);
 *  - any other divergence from the stronger scope's rule (different trigger /
 *    require / denyTools) → rejection, because a specific scope may only ADD
 *    new rules, never redefine an existing stronger-scope rule.
 *
 * Identical re-declarations are allowed (redundant but not weakening).
 */
export type MonotonicityResult = { ok: true } | { ok: false; errors: string[] }

export function validateScopeMonotonicity(policies: ScopedPolicy[]): MonotonicityResult {
  const errors: string[] = []

  // Strongest-scope owner of each active rule id.
  const owner = new Map<string, { scope: RuleScope; rule: HardRule }>()
  const ordered = [...policies].sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope])
  for (const { scope, document } of ordered) {
    for (const rule of document.policy.hard) {
      if (rule.enabled === false) continue
      if (!owner.has(rule.id)) owner.set(rule.id, { scope, rule })
    }
  }

  for (const { scope, document } of policies) {
    for (const rule of document.policy.hard) {
      if (rule.enabled === false) {
        const stronger = owner.get(rule.id)
        if (stronger !== undefined && SCOPE_RANK[scope] > SCOPE_RANK[stronger.scope]) {
          errors.push(
            `rule "${rule.id}" in scope "${scope}" attempts to disable a stronger-scope ` +
            `("${stronger.scope}") hard rule — constraint monotonicity forbids weakening`,
          )
        }
        continue
      }
      const stronger = owner.get(rule.id)
      if (stronger !== undefined && SCOPE_RANK[scope] > SCOPE_RANK[stronger.scope]) {
        if (!rulesEqual(rule, stronger.rule)) {
          errors.push(
            `rule "${rule.id}" in scope "${scope}" redefines a stronger-scope ` +
            `("${stronger.scope}") hard rule — a specific scope may only ADD rules, not weaken`,
          )
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true }
}

/**
 * Structural equality for two hard rules (id excluded). Key order is
 * canonicalized before comparison: two JSON documents carrying the same rule
 * with different key order are semantically identical and must NOT trigger a
 * "redefinition" rejection.
 */
function rulesEqual(a: HardRule, b: HardRule): boolean {
  return canonicalize(a) === canonicalize(b)
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}
