import { confidenceOf } from './confidence.ts'
import { signatureSubject } from './signature.ts'
import type { CandidateBehavior, ObservationRecord, PromotionThreshold } from './types.ts'
import { DEFAULT_THRESHOLD } from './types.ts'

export interface ObserverOptions {
  threshold?: PromotionThreshold
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

const EVIDENCE_CAP = 5

function draftFor(kind: CandidateBehavior['kind'], signature: string, occurrences: number, sessions: number): string {
  const subject = signatureSubject(signature)
  const times = `${occurrences}× across ${sessions} session(s)`
  switch (kind) {
    case 'remediation_repeated':
      return `Observed pattern: the agent repeatedly needed remediation for rule "${subject}" (${times}). Consider confirming this as behavior guidance, or reviewing the workflow.`
    case 'hard_block_repeated':
      return `Observed pattern: rule "${subject}" keeps hard-blocking turn completion (${times}). Maybe the rule needs a clearer remediation message, or the workflow needs adjusting.`
    case 'tool_denied_repeated':
      return `Observed pattern: the agent repeatedly tried the forbidden tool "${subject}" (${times}). Consider a project rule documenting the allowed alternative.`
    case 'user_correction':
      return `Observed pattern: the user repeatedly issued corrections like "${subject}" (${times}). A behavior guard could remind the agent earlier.`
    case 'test_fail_streak':
      return `Observed pattern: test failures repeatedly ended in user takeover (${times}). Consider guidance on running tests earlier.`
  }
}

/**
 * Pure aggregation core: observations in, candidates out. Zero Harness
 * dependencies, zero I/O, deterministic (injectable clock).
 *
 * Non-blocking invariant: this class has no write path to user model or
 * policy state — it can only ever PRODUCE candidate objects for the user
 * to review (Stage 12).
 */
export class BehaviorObserver {
  readonly #observations: ObservationRecord[] = []
  readonly #tombstones = new Set<string>()
  #threshold: PromotionThreshold
  readonly #now: () => number

  constructor(options: ObserverOptions = {}) {
    this.#threshold = options.threshold ?? DEFAULT_THRESHOLD
    this.#now = options.now ?? Date.now
  }

  get threshold(): PromotionThreshold {
    return this.#threshold
  }

  /** Record one observation and return the candidate if it just promoted. */
  note(record: ObservationRecord): CandidateBehavior | undefined {
    this.#observations.push(record)
    return this.recompute(record.signature)
  }

  /** Rejected signatures are tombstoned: same-signature candidates never reappear. */
  reject(signature: string): void {
    this.#tombstones.add(signature)
  }

  isRejected(signature: string): boolean {
    return this.#tombstones.has(signature)
  }

  observations(): readonly ObservationRecord[] {
    return this.#observations
  }

  /** Restore state from persistence (observations log + tombstone list). */
  hydrate(records: readonly ObservationRecord[], tombstones: readonly string[]): void {
    for (const record of records) this.#observations.push(record)
    for (const signature of tombstones) this.#tombstones.add(signature)
  }

  /** Currently promoted candidates, recomputed from scratch (durable projection source). */
  candidates(): CandidateBehavior[] {
    const promoted: CandidateBehavior[] = []
    for (const signature of this.#signatures()) {
      const candidate = this.recompute(signature)
      if (candidate !== undefined) promoted.push(candidate)
    }
    return promoted
  }

  /**
   * Recompute one signature's aggregate; return the candidate when it meets
   * the promotion threshold.
   */
  recompute(signature: string): CandidateBehavior | undefined {
    if (this.#tombstones.has(signature)) return undefined
    const records = this.#observations.filter(record => record.signature === signature)
    if (records.length === 0) return undefined

    const occurrences = records.length
    const sessions = new Set(records.map(record => record.sessionId))
    const firstSeen = Math.min(...records.map(record => record.at))
    const lastSeen = Math.max(...records.map(record => record.at))
    const confidence = confidenceOf({
      kind: records[0]!.kind,
      occurrences,
      distinctSessions: sessions.size,
      lastSeenAt: lastSeen,
      now: this.#now(),
    })
    if (confidence < this.#threshold.minConfidence || occurrences < this.#threshold.minOccurrences) {
      return undefined
    }

    return {
      id: `candidate:${signature}`,
      kind: records[0]!.kind,
      signature,
      occurrences,
      distinctSessions: sessions.size,
      firstSeen,
      lastSeen,
      confidence: Math.round(confidence * 1000) / 1000,
      draftMessage: draftFor(records[0]!.kind, signature, occurrences, sessions.size),
      status: 'candidate',
      evidence: records.slice(-EVIDENCE_CAP).map(record => ({
        sessionId: record.sessionId,
        at: record.at,
        detail: record.detail,
      })),
    }
  }

  #signatures(): string[] {
    return [...new Set(this.#observations.map(record => record.signature))]
  }
}
