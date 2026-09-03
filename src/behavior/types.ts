/**
 * Behavior observation types (plan §Phase 7, roadmap §3).
 *
 * Observations are facts the runtime itself produced or saw — they are NEVER
 * durable user state. A candidate only exists to be shown to the user for a
 * confirm/edit/reject decision (Stage 12); until then it changes nothing.
 */
export type ObservationKind =
  | 'remediation_repeated'   // same rule needed remediation repeatedly (runtime proof)
  | 'hard_block_repeated'    // same rule keeps hard-refusing turns (runtime proof)
  | 'tool_denied_repeated'   // agent keeps trying a forbidden tool (runtime proof)
  | 'user_correction'        // user issued short corrective messages (heuristic, low precision)
  | 'test_fail_streak'       // reserved: failures ending in user takeover (deferred, see stage-10 report)

/** One "this happened" atomic fact, pointing back at where it was seen. */
export interface EvidencePointer {
  sessionId: string
  at: number
  detail: string
}

export interface ObservationRecord {
  kind: ObservationKind
  /** Dedup/aggregation key — see signature.ts. */
  signature: string
  sessionId: string
  at: number
  detail: string
}

export type CandidateStatus = 'candidate' | 'confirmed' | 'rejected'

export interface CandidateBehavior {
  /** Stable id derived from the signature (survives restarts, Stage 12 provenance). */
  id: string
  kind: ObservationKind
  signature: string
  occurrences: number
  distinctSessions: number
  firstSeen: number
  lastSeen: number
  /** Deterministic score in [0,1] — see confidence.ts. No LLM involved. */
  confidence: number
  /** Template-drafted reminder text the user may confirm into a BehaviorGuard. */
  draftMessage: string
  status: CandidateStatus
  /** Most recent evidence pointers (capped) backing this candidate. */
  evidence: EvidencePointer[]
}

export interface PromotionThreshold {
  minConfidence: number
  minOccurrences: number
}

/**
 * Default promotion gate. Rationale (roadmap §3.4): a single occurrence can
 * never promote — the formula caps one-occurrence runtime-proof signals at
 * 0.573 < 0.6. Two occurrences across two sessions of runtime-proof evidence
 * score ≈0.75 and DO promote, which is the point: a pattern the runtime had
 * to correct twice is already worth showing to the user.
 */
export const DEFAULT_THRESHOLD: PromotionThreshold = { minConfidence: 0.6, minOccurrences: 2 }
