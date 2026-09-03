import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectRegistry, ProjectState } from '../../src/project/registry.ts'
import {
  archiveProject,
  isActive,
  loadRegistry,
  projectRegistryPath,
  saveRegistry,
  setProjectState,
} from '../../src/project/registry.ts'

/**
 * Stage 14 — Project lifecycle registry (plan §Phase 14, roadmap §7.2).
 * A project's hard rules have a lifecycle; non-active projects must not leak
 * their rules into resolution.
 */

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-registry-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const registryPath = () => join(dir, 'project-registry.json')

describe('loadRegistry', () => {
  it('returns an empty registry when the file is absent', () => {
    expect(loadRegistry(registryPath())).toEqual({ projects: {} })
  })

  it('returns an empty registry (no throw) when the file is corrupt JSON', () => {
    writeFileSync(registryPath(), '{not json')
    expect(loadRegistry(registryPath())).toEqual({ projects: {} })
  })

  it('returns an empty registry (no throw) when the shape is wrong', () => {
    writeFileSync(registryPath(), JSON.stringify({ foo: 1 }))
    expect(loadRegistry(registryPath())).toEqual({ projects: {} })
  })

  it('round-trips a saved registry', () => {
    const reg: ProjectRegistry = { projects: { a: { state: 'paused' } } }
    saveRegistry(reg, registryPath())
    expect(loadRegistry(registryPath())).toEqual(reg)
  })
})

describe('isActive', () => {
  const cases: [ProjectState | undefined, boolean][] = [
    [undefined, true], // unregistered project = active
    ['active', true],
    ['paused', false],
    ['completed', false],
    ['archived', false],
  ]
  for (const [state, expected] of cases) {
    it(`state=${state ?? 'unregistered'} → active=${expected}`, () => {
      const registry: ProjectRegistry = state === undefined ? { projects: {} } : { projects: { p: { state } } }
      expect(isActive(registry, 'p')).toBe(expected)
    })
  }
})

describe('setProjectState', () => {
  it('is immutable — the input registry is not mutated', () => {
    const registry: ProjectRegistry = { projects: {} }
    const next = setProjectState(registry, 'p', 'paused')
    expect(registry.projects).toEqual({})
    expect(next.projects.p!).toEqual({ state: 'paused' })
  })

  it('records archivedAt when archiving', () => {
    const next = setProjectState({ projects: {} }, 'p', 'archived')
    expect(next.projects.p!.state).toBe('archived')
    expect(typeof next.projects.p!.archivedAt).toBe('number')
  })

  it('does not set archivedAt for non-archived states', () => {
    const next = setProjectState({ projects: {} }, 'p', 'completed')
    expect(next.projects.p).toEqual({ state: 'completed' })
  })
})

describe('archiveProject', () => {
  it('marks the registry archived AND moves .dsh-policy into archive/', () => {
    const projectDir = join(dir, 'myproj')
    const policyDir = join(projectDir, '.dsh-policy')
    mkdirSync(policyDir, { recursive: true })
    writeFileSync(join(policyDir, 'policy.json'), '{}')

    const registry: ProjectRegistry = { projects: {} }
    archiveProject('myproj', projectDir, registry, registryPath())

    // registry marked
    const saved = loadRegistry(registryPath())
    expect(saved.projects.myproj!.state).toBe('archived')
    expect(typeof saved.projects.myproj!.archivedAt).toBe('number')

    // .dsh-policy moved out of the project root
    expect(existsSync(policyDir)).toBe(false)
    const moved = readdirSync(join(projectDir, 'archive'))
    expect(moved.length).toBe(1)
    expect(moved[0]).toMatch(/^dsh-policy-myproj-/)
  })

  it('still marks archived when no .dsh-policy directory exists', () => {
    const projectDir = join(dir, 'empty-proj')
    mkdirSync(projectDir, { recursive: true })
    const registry: ProjectRegistry = { projects: {} }
    archiveProject('empty-proj', projectDir, registry, registryPath())
    expect(loadRegistry(registryPath()).projects['empty-proj']!.state).toBe('archived')
  })
})

describe('projectRegistryPath', () => {
  it('points at ~/.dsh-policy/project-registry.json', () => {
    expect(projectRegistryPath('C:/Users/u')).toMatch(/[\\/]\.dsh-policy[\\/]project-registry\.json$/)
  })
})
