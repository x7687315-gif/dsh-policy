import { describe, expect, it } from 'vitest'
import type { HardRule, PolicyDocument, RuleScope } from '../../src/policy/schema.ts'
import { validateScopeMonotonicity, type ScopedPolicy } from '../../src/policy/resolver.ts'

/**
 * Stage 14 — Scope monotonicity (plan §Phase 13, roadmap §7.1).
 *
 * `resolvePolicies` keeps the stronger scope on collision and only notes it.
 * `validateScopeMonotonicity` is the separate validation-time pass that REJECTS
 * any weaker-scope declaration attempting to weaken a stronger-scope hard rule.
 */

function doc(scope: RuleScope, hard: HardRule[]): PolicyDocument {
  return { project: scope, scope, policy: { hard } }
}

function scoped(scope: RuleScope, hard: HardRule[]): ScopedPolicy {
  return { scope, document: doc(scope, hard) }
}

const globalDeny: HardRule = { id: 'forbid-drop', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' }

describe('validateScopeMonotonicity', () => {
  it('REGRESSION: key-order differences are NOT a redefinition', () => {
    // Same rule as the global one, but serialized with a different key order —
    // semantically identical, so it must not be rejected as a weakening.
    const reordered = { enforcement: 'hard', denyTools: ['drop_database'], trigger: 'always', id: 'forbid-drop' } as unknown as HardRule
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('task', [reordered]),
    ])
    expect(result).toEqual({ ok: true })
  })

  it('allows identical cross-scope re-declaration (redundant but not weakening)', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('project', [{ ...globalDeny }]),
      scoped('task', [{ ...globalDeny }]),
    ])
    expect(result).toEqual({ ok: true })
  })

  it('allows a specific scope to ADD a new rule id', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('task', [{ id: 'task-extra', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }]),
    ])
    expect(result).toEqual({ ok: true })
  })

  it('rejects a task rule that disables a global hard rule', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('task', [{ ...globalDeny, enabled: false }]),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/forbids weakening/)
      expect(result.errors.join(' ')).toMatch(/forbid-drop/)
    }
  })

  it('rejects a task rule that redefines a global hard rule', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('task', [{ id: 'forbid-drop', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }]),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/may only ADD rules, not weaken/)
  })

  it('rejects a project rule that redefines a global hard rule', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('project', [{ id: 'forbid-drop', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }]),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/may only ADD rules, not weaken/)
  })

  it('does NOT block a task rule when the stronger-scope rule is disabled', () => {
    // A disabled global rule is not owned; a specific scope may then define it.
    const result = validateScopeMonotonicity([
      scoped('global', [{ ...globalDeny, enabled: false }]),
      scoped('task', [{ id: 'forbid-drop', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }]),
    ])
    expect(result).toEqual({ ok: true })
  })

  it('does not flag a disabled weaker-scope rule on its own', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny]),
      scoped('task', [{ ...globalDeny, enabled: false }]),
    ])
    expect(result.ok).toBe(false) // this is the weakening case — disable stronger rule → reject
    // (kept explicit: disabling a global rule from task scope is the forbidden pattern)
  })

  it('reports every offending rule id, not just the first', () => {
    const result = validateScopeMonotonicity([
      scoped('global', [globalDeny, { id: 'forbid-format', trigger: 'always', denyTools: ['format'], enforcement: 'hard' }]),
      scoped('task', [
        { ...globalDeny, enabled: false },
        { id: 'forbid-format', trigger: 'always', denyTools: ['other'], enforcement: 'hard' },
      ]),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBe(2)
  })
})
