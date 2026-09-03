import type { BehaviorGuardRule } from '../behavior/guard.ts'
import type { UserModelRecord } from './schema.ts'
import { readUserModel } from './store.ts'

/** Convenience: read a model file and project its guards in one call. */
export function readUserModelGuardRules(path: string): UserModelRecord[] {
  return readUserModel(path)
}

/**
 * Read-path projection: enabled behavior-pattern records become plugin
 * `guards`. This is the ONLY way the plugin runtime consumes the user model —
 * strictly read-only, no mutation surface exists here (plan §2.1).
 */
export function guardsFromUserModel(records: readonly UserModelRecord[]): BehaviorGuardRule[] {
  return records
    .filter(record => record.enabled && record.kind === 'behavior_pattern')
    .map(record => {
      const value = record.value as { message?: string; trigger?: BehaviorGuardRule['trigger']; severity?: 'info' | 'warn' }
      return {
        id: `guard:${record.id}`,
        message: value.message ?? '',
        trigger: value.trigger ?? { always: true },
        severity: value.severity ?? 'info',
        provenance: {
          candidateId: record.provenance.candidateId,
          confirmedAt: record.provenance.confirmedAt,
        },
      }
    })
    .filter(guard => guard.message.length > 0)
}
