import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectPolicy, resolveGlobalPolicy } from '../../src/plugin/index.ts'
import { PolicyLoadError } from '../../src/policy/loader.ts'

/**
 * Stage 18 — real-environment policy DISCOVERY semantics.
 *
 * In a real deployment the plugin mounts WITHOUT inline options and discovers
 * `.dsh-policy/policy.json` from the working directory. These tests pin the
 * distinction the field experience requires:
 *   - an ABSENT policy file (fresh project) must NOT take down the whole
 *     Harness session — the plugin runs with an empty rule set;
 *   - a CORRUPT file still fails loud (silent enforcement gaps are worse);
 *   - an EXPLICIT path/policy option is an assertion — missing files throw;
 *   - the global layer is optional by nature — absent file means "no global
 *     rules", corrupt file fails loud.
 */

const VALID = {
  project: 'p',
  policy: { hard: [{ id: 'r', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
} as const

function fixtureDir(withPolicy: boolean | 'corrupt'): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-realenv-'))
  if (withPolicy !== false) {
    mkdirSync(join(dir, '.dsh-policy'), { recursive: true })
    writeFileSync(
      join(dir, '.dsh-policy', 'policy.json'),
      withPolicy === 'corrupt' ? '{ broken' : JSON.stringify(VALID),
    )
  }
  return dir
}

describe('resolveProjectPolicy — discovery semantics', () => {
  it('REGRESSION: an absent default policy runs with an empty rule set (no crash)', () => {
    const dir = fixtureDir(false)
    try {
      const resolution = resolveProjectPolicy({}, dir, true)
      expect(resolution.source).toBe('absent')
      expect(resolution.document.policy.hard).toEqual([])
      expect(resolution.document.project).toBe('discovered-project')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a discovered policy file is loaded', () => {
    const dir = fixtureDir(true)
    try {
      const resolution = resolveProjectPolicy({}, dir, true)
      expect(resolution.source).toBe('discovered')
      expect(resolution.document.policy.hard).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a CORRUPT discovered policy still fails loud', () => {
    const dir = fixtureDir('corrupt')
    try {
      expect(() => resolveProjectPolicy({}, dir, true)).toThrow(PolicyLoadError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an explicit policyPath that is missing fails loud (an assertion was made)', () => {
    const dir = fixtureDir(false)
    try {
      expect(() => resolveProjectPolicy({ policyPath: join(dir, 'nope.json') }, dir, true)).toThrow(PolicyLoadError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an inline policy wins and an inactive project yields an empty document', () => {
    const inline = { project: 'x', policy: { hard: [] } }
    expect(resolveProjectPolicy({ policy: inline }, '/anywhere', true)).toMatchObject({ source: 'inline' })
    const inactive = resolveProjectPolicy({ policy: inline, projectId: 'p1' }, '/anywhere', false)
    expect(inactive.source).toBe('inactive')
    expect(inactive.document.policy.hard).toEqual([])
  })
})

describe('resolveGlobalPolicy — optional-layer semantics', () => {
  it('REGRESSION: an explicit-but-absent global path means "no global rules" (no crash)', () => {
    const missing = join(tmpdir(), 'dsh-realenv-no-global', `${Date.now()}.json`)
    expect(existsSync(missing)).toBe(false)
    expect(resolveGlobalPolicy({ globalPolicyPath: missing })).toBeUndefined()
  })

  it('a corrupt global file fails loud', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-realenv-'))
    try {
      const corrupt = join(dir, 'global.json')
      writeFileSync(corrupt, '{ nope')
      expect(() => resolveGlobalPolicy({ globalPolicyPath: corrupt })).toThrow(PolicyLoadError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
