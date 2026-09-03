import { describe, expect, it } from 'vitest'
import type { DenyToolsRule } from '../../src/policy/schema.ts'
import type { Resolution } from '../../src/policy/resolver.ts'
import { preferencesFromUserModel } from '../../src/usermodel/preferences.ts'
import type { ResolvedPreference } from '../../src/usermodel/preferences.ts'
import type { UserModelRecord } from '../../src/usermodel/schema.ts'
import { estimateTokens, globToRegExp, matchPreference, resolveContext } from '../../src/context/resolver.ts'

function mkPref(over: Partial<ResolvedPreference> & { id: string; text: string }): ResolvedPreference {
  return { priority: 50, recency: 1, ...over }
}

const EMPTY_RESOLUTION: Resolution = { rules: [], conflicts: [], monotonicityNotes: [] }

const HARD_RESOLUTION: Resolution = {
  rules: [
    { id: 'deny-drop', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' },
    { id: 'require-tests', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' },
    { id: 'require-typecheck', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' },
  ] as DenyToolsRule[],
  conflicts: [],
  monotonicityNotes: [],
}

describe('Context Resolver — relevance matching (deterministic, no LLM)', () => {
  const task = { userMessage: 'refactor the api module', recentFiles: ['src/api/user.ts'], recentTools: ['edit_file'] }

  it('unconditional preference (no appliesTo) always matches', () => {
    expect(matchPreference(mkPref({ id: 'p1', text: 'x', appliesTo: {} }), task)).toBe(true)
    expect(matchPreference(mkPref({ id: 'p2', text: 'x' }), task)).toBe(true)
  })

  it('matches by language inferred from file extension', () => {
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { language: 'typescript' } }), task)).toBe(true)
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { language: 'python' } }), task)).toBe(false)
  })

  it('matches by file glob (built-in, no picomatch dependency)', () => {
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { fileGlob: ['src/**/*.ts'] } }), task)).toBe(true)
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { fileGlob: ['tests/**/*.ts'] } }), task)).toBe(false)
  })

  it('matches by taskRegex against the latest user message', () => {
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { taskRegex: 'refactor|重构' } }), task)).toBe(true)
    expect(matchPreference(mkPref({ id: 'p', text: 'x', appliesTo: { taskRegex: 'database' } }), task)).toBe(false)
  })
})

describe('Context Resolver — globToRegExp', () => {
  it('supports ** , * , ?', () => {
    expect(globToRegExp('src/**/*.ts').test('src/api/user.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.js')).toBe(false)
    expect(globToRegExp('*.ts').test('user.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('a/b/user.ts')).toBe(false) // * does not cross separators
    expect(globToRegExp('a?c').test('abc')).toBe(true)
    expect(globToRegExp('a?c').test('ac')).toBe(false)
  })

  it('escapes regex metacharacters in literals', () => {
    expect(globToRegExp('a.b.ts').test('a.b.ts')).toBe(true)
    expect(globToRegExp('a.b.ts').test('axbts')).toBe(false)
  })
})

describe('Context Resolver — token budget eviction (roadmap §6.2)', () => {
  it('keeps all hard rules and evicts the lowest-priority preferences first', () => {
    const preferences: ResolvedPreference[] = Array.from({ length: 50 }, (_, i) => {
      const priority = i + 1 // 1..50
      return mkPref({ id: `p${priority}`, text: `prefer option ${priority}`, priority, recency: priority })
    })

    const bundle = resolveContext({
      taskProfile: { userMessage: '', recentFiles: [], recentTools: [] },
      resolution: HARD_RESOLUTION,
      guards: [],
      preferences,
      tokenBudget: 200,
    })

    // Hard rules are never evicted — the 900 section is always present.
    const hardSection = bundle.sections.find(s => s.order === 900)
    expect(hardSection).toBeDefined()
    for (const id of ['deny-drop', 'require-tests', 'require-typecheck']) {
      expect(hardSection!.text).toContain(id)
    }
    expect(hardSection!.text).not.toContain('prefer option')

    // Over budget → eviction happened, and the note is present.
    expect(bundle.truncation).toBeDefined()
    expect(bundle.truncation!.omittedCount).toBeGreaterThan(0)
    const allText = bundle.sections.map(s => s.text).join('\n')
    expect(allText).toMatch(/\(\+\d+ items omitted/)

    // Highest-priority preferences survive; lowest are dropped.
    const prefSection = bundle.sections.find(s => s.order === 920)
    expect(prefSection!.text).toContain('prefer option 50')
    expect(prefSection!.text).not.toContain('prefer option 1')
  })

  it('orders survivors by priority then recency, keeping the most important', () => {
    const preferences: ResolvedPreference[] = [
      mkPref({ id: 'low', text: 'prefer option 10', priority: 10, recency: 100 }),
      mkPref({ id: 'high', text: 'prefer option 90', priority: 90, recency: 200 }),
    ]
    const bundle = resolveContext({
      taskProfile: { userMessage: '', recentFiles: [], recentTools: [] },
      resolution: EMPTY_RESOLUTION,
      guards: [],
      preferences,
      tokenBudget: 30, // header + one preference only
    })
    const prefSection = bundle.sections.find(s => s.order === 920)
    expect(prefSection!.text).toContain('prefer option 90')
    expect(prefSection!.text).not.toContain('prefer option 10')
  })
})

describe('Context Resolver — non-blocking invariant (pure level)', () => {
  it('preference text lives only in the 920 section, never in the hard 900 section', () => {
    const bundle = resolveContext({
      taskProfile: { userMessage: 'api', recentFiles: [], recentTools: [] },
      resolution: HARD_RESOLUTION,
      guards: [],
      preferences: [mkPref({ id: 'p1', text: 'Use async/await', appliesTo: { taskRegex: 'api' } })],
    })
    const hard = bundle.sections.find(s => s.order === 900)!
    const pref = bundle.sections.find(s => s.order === 920)!
    expect(pref.text).toContain('Use async/await')
    expect(hard.text).not.toContain('Use async/await')
    expect(pref.order).toBeGreaterThan(hard.order) // 920 > 900 in physical prompt order
  })
})

describe('preference projection (read path)', () => {
  const records: UserModelRecord[] = [
    { id: 'um-1', kind: 'preference', value: { text: 'Use async/await', kind: 'style', appliesTo: { taskRegex: 'api' }, priority: 70 }, scope: 'user', enabled: true, createdAt: 100, updatedAt: 200, provenance: { confirmedAt: 100, confirmedBy: 'user' } },
    { id: 'um-2', kind: 'preference', value: { text: 'disabled pref' }, scope: 'user', enabled: false, createdAt: 100, updatedAt: 200, provenance: { confirmedAt: 100, confirmedBy: 'user' } },
    { id: 'um-3', kind: 'behavior_pattern', value: { message: 'a guard', trigger: { always: true } }, scope: 'user', enabled: true, createdAt: 100, updatedAt: 200, provenance: { confirmedAt: 100, confirmedBy: 'user' } },
  ]

  it('projects only enabled preference records, carrying kind/appliesTo/priority/recency', () => {
    const prefs = preferencesFromUserModel(records)
    expect(prefs).toHaveLength(1)
    expect(prefs[0]!.id).toBe('pref:um-1')
    expect(prefs[0]!.kind).toBe('style')
    expect(prefs[0]!.appliesTo).toEqual({ taskRegex: 'api' })
    expect(prefs[0]!.priority).toBe(70)
    expect(prefs[0]!.recency).toBe(200)
    // behavior_pattern records are NOT projected as preferences
    expect(prefs.find(p => p.id === 'pref:um-3')).toBeUndefined()
  })
})
