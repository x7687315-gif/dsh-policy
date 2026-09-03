import type { BehaviorGuardTrigger } from '../behavior/guard.ts'

export const USER_MODEL_VERSION = 1

export type UserModelKind = 'behavior_pattern' | 'preference'

/** Confirmed behavior-pattern content — maps 1:1 onto a BehaviorGuardRule. */
export interface BehaviorPatternValue {
  message: string
  trigger: BehaviorGuardTrigger
  severity?: 'info' | 'warn'
}

/** Relevance input for the Context Resolver (roadmap §6.1). */
export interface PreferenceAppliesTo {
  /** Match by inferred language, e.g. 'typescript' (from file extension). */
  language?: string
  /** Match by file glob, e.g. a 'src/**' pattern. */
  fileGlob?: string[]
  /** Match when the latest user message matches this regex. */
  taskRegex?: string
}

/**
 * Preference content (Stage 13): soft, non-binding guidance with relevance
 * metadata. Stored as a `UserModelRecord` of `kind: 'preference'` — the
 * record envelope (id/scope/enabled/createdAt/updatedAt/provenance) already
 * lives on `UserModelRecord`, so we only enrich the *value* here. No zod: the
 * project validates by hand-rolled types, and the single write path
 * (`UserModelStore.create` + `ConfirmRequest`) is the real safety boundary.
 */
export interface PreferenceValue {
  /** The soft guidance text injected into the model prompt. */
  text: string
  /** 'style' (e.g. async/await, quote style) or 'workflow' (e.g. review diffs before commit). */
  kind?: 'style' | 'workflow'
  /** Relevance input for the Context Resolver. */
  appliesTo?: PreferenceAppliesTo
  /** Higher = kept first under the token budget. Default 50. */
  priority?: number
}

export type UserModelValue = BehaviorPatternValue | PreferenceValue

/**
 * One durable personalization fact (plan §Phase 9). Every record answers
 * plan §11.7 in its own fields: who authorized it (confirmedBy), when, and
 * from which candidate (provenance.candidateId).
 */
export interface UserModelRecord {
  id: string
  kind: UserModelKind
  value: UserModelValue
  scope: 'user'
  enabled: boolean
  createdAt: number
  updatedAt: number
  provenance: {
    candidateId?: string
    confirmedAt: number
    confirmedBy: 'user'
  }
}

export interface UserModelFile {
  version: number
  records: UserModelRecord[]
}

/**
 * Every mutation must carry an explicit authorization statement. This is not
 * a security boundary — it forces every call site to ANSWER plan §11.7
 * ("who authorized this durable rule?") in code, and it keeps the plugin
 * runtime (which never has a reason to construct one) on the read path.
 */
export interface ConfirmRequest {
  via: 'review-cli' | 'review-ui' | 'user-api'
  note?: string
}

/** Append-only audit trail entry (one per mutation, never rewritten). */
export interface AuditEntry {
  at: number
  actor: 'user'
  op: 'create' | 'update' | 'disable' | 'delete'
  recordId: string
  via: ConfirmRequest['via']
  note?: string
  diff?: string
}
