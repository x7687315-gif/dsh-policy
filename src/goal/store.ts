import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GoalNode } from './types.ts'

/** Default on-disk location for the read-only goal projection. */
export function defaultGoalPath(): string {
  return join(homedir(), '.dsh-policy', 'goals.json')
}

/**
 * Read goals from disk (read-only projection — the plugin never writes goals,
 * matching the plan §2.1 write-path discipline). Missing file → empty list
 * (goals are optional; absence is not an error).
 *
 * Accepts either a bare array or `{ goals: [...] }` envelope.
 */
export function readGoals(path: string): GoalNode[] {
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as GoalNode[] | { goals?: GoalNode[] }
  return Array.isArray(parsed) ? parsed : (parsed.goals ?? [])
}
