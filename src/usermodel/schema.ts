import type { BehaviorGuardTrigger } from '../behavior/guard.ts'

export const USER_MODEL_VERSION = 1

export type UserModelKind = 'behavior_pattern' | 'preference'

/** Confirmed behavior-pattern content — maps 1:1 onto a BehaviorGuardRule. */
export interface BehaviorPatternValue {
  message: string
  trigger: BehaviorGuardTrigger
  severity?: 'info' | 'warn'
}

/** Minimal preference content for v1 (resolution arrives in Stage 13). */
export interface PreferenceValue {
  text: string
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
