import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Project lifecycle registry (plan §Phase 14, roadmap §7.2).
 *
 * A project's hard rules have a lifecycle: they are created active, may be
 * paused or completed, and eventually archived. Non-active projects must not
 * leak their rules into unrelated work — the plugin reads this registry at
 * activation and excludes non-active project policies from the resolution.
 *
 * This module is the ONLY writer of `project-registry.json` and the archive
 * move; the plugin runtime only reads it (read-only consumption, matching the
 * user-model boundary).
 */

export type ProjectState = 'active' | 'paused' | 'completed' | 'archived'

export interface ProjectEntry {
  state: ProjectState
  /** Set when the project is archived (roadmap §7.2: history preserved). */
  archivedAt?: number
}

export interface ProjectRegistry {
  /** project id → lifecycle entry. */
  projects: Record<string, ProjectEntry>
}

/** Default registry location: `~/.dsh-policy/project-registry.json`. */
export function projectRegistryPath(home: string = homedir()): string {
  return resolve(home, '.dsh-policy', 'project-registry.json')
}

/** Load the registry; an absent file yields an empty registry (no projects yet). */
export function loadRegistry(path: string = projectRegistryPath()): ProjectRegistry {
  if (!existsSync(path)) return { projects: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // A corrupt registry must not silently disable every project's rules.
    // Treat as empty and let the next save heal it.
    return { projects: {} }
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { projects?: unknown }).projects !== 'object') {
    return { projects: {} }
  }
  return { projects: (parsed as ProjectRegistry).projects }
}

export function saveRegistry(registry: ProjectRegistry, path: string = projectRegistryPath()): void {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(registry, null, 2))
}

/**
 * A project is "active" for enforcement when it is either not yet registered
 * (fresh project) or explicitly `active`. Any other state (paused / completed
 * / archived) excludes its rules from resolution.
 */
export function isActive(registry: ProjectRegistry, projectId: string): boolean {
  const entry = registry.projects[projectId]
  return entry === undefined || entry.state === 'active'
}

/** Immutable state transition. Returns a new registry (does not mutate input). */
export function setProjectState(
  registry: ProjectRegistry,
  projectId: string,
  state: ProjectState,
): ProjectRegistry {
  const entry: ProjectEntry = state === 'archived'
    ? { state, archivedAt: Date.now() }
    : { state }
  return { projects: { ...registry.projects, [projectId]: entry } }
}

/**
 * Archive a project: mark it `archived` in the registry AND move its
 * `.dsh-policy` directory into `<projectDir>/archive/` so its policy file is
 * preserved but no longer discovered by the loader (history kept, not leaked).
 *
 * `projectDir` is the project root that contains `.dsh-policy`. The move is a
 * same-filesystem rename; if `.dsh-policy` is absent, only the registry mark
 * is applied.
 */
export function archiveProject(
  projectId: string,
  projectDir: string,
  registry: ProjectRegistry,
  registryPath: string = projectRegistryPath(),
): ProjectRegistry {
  const source = join(projectDir, '.dsh-policy')
  if (existsSync(source)) {
    const archiveDir = join(projectDir, 'archive')
    mkdirSync(archiveDir, { recursive: true })
    const destination = join(archiveDir, `dsh-policy-${projectId}-${Date.now()}`)
    renameSync(source, destination)
  }
  const next = setProjectState(registry, projectId, 'archived')
  saveRegistry(next, registryPath)
  return next
}
