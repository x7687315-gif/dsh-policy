import type { HardRule, PolicyDocument, RuleScope, ToolPassRule } from './schema.ts'
import { requireTool } from './schema.ts'

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

const SCOPE_RANK: Record<RuleScope, number> = { global: 0, project: 1 }

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
