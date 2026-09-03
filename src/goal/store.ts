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
 * Accepts either a bare array or `{ goals: [...] }` envelope. A corrupt file
 * yields an empty list rather than throwing: goals are ADVISORY context, so a
 * broken file must not fail plugin activation (contrast with policies and the
 * user model, where corruption IS loud by design — those gate enforcement).
 */
export function readGoals(path: string): GoalNode[] {
  if (!existsSync(path)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  if (Array.isArray(parsed)) return parsed as GoalNode[]
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { goals?: unknown }).goals)) {
    return (parsed as { goals: GoalNode[] }).goals
  }
  return []
}
