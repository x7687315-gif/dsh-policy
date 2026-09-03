import type { PreferenceValue, UserModelRecord } from './schema.ts'
import { readUserModel } from './store.ts'

/**
 * A preference resolved for the Context Resolver (plan §Phase 11-12). The
 * durable envelope fields (id/scope/enabled/createdAt/updatedAt/provenance)
 * come from `UserModelRecord`; this shape carries only what the resolver's
 * relevance + budget logic needs.
 */
export interface ResolvedPreference {
  /** `pref:<recordId>` — mirrors `guard:<recordId>` from guardsFromUserModel. */
  id: string
  /** The soft guidance text. */
  text: string
  kind?: 'style' | 'workflow'
  appliesTo?: { language?: string; fileGlob?: string[]; taskRegex?: string }
  /** Effective priority (resolver default 50 when unset). */
  priority: number
  /** Recency for tie-breaking under the budget — the record's updatedAt. */
  recency: number
}

/** Convenience: read a model file and project its preferences in one call. */
export function readUserModelPreferenceRules(path: string): UserModelRecord[] {
  return readUserModel(path)
}

/**
 * Read-path projection: enabled `preference` records become resolver inputs.
 * This is the ONLY way the plugin runtime consumes preferences — strictly
 * read-only, no mutation surface exists here (plan §2.1). Disabled records and
 * records with empty text are dropped, matching the guard projection's
 * "contribute nothing when inactive" rule.
 */
export function preferencesFromUserModel(records: readonly UserModelRecord[]): ResolvedPreference[] {
  return records
    .filter(record => record.enabled && record.kind === 'preference')
    .map(record => {
      const value = record.value as PreferenceValue & {
        kind?: 'style' | 'workflow'
        appliesTo?: { language?: string; fileGlob?: string[]; taskRegex?: string }
        priority?: number
      }
      return {
        id: `pref:${record.id}`,
        text: value.text ?? '',
        kind: value.kind,
        appliesTo: value.appliesTo,
        priority: value.priority ?? 50,
        recency: record.updatedAt,
      }
    })
    .filter(preference => preference.text.length > 0)
}
