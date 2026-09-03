import { BehaviorObserver } from './observer.ts'
import { BehaviorStore } from './store.ts'
import { correctionSignature } from './signature.ts'
import type { CandidateBehavior, ObservationRecord, PromotionThreshold } from './types.ts'

export interface BehaviorOptions {
  /** Opt-in (default false): observation never runs unless explicitly enabled. */
  enabled?: boolean
  /** Persistence directory; undefined keeps everything in memory. */
  root?: string
  threshold?: PromotionThreshold
  /** Substrings (case-insensitive) that mark a short user message as a correction. */
  correctionPhrases?: string[]
  /** User messages longer than this are never treated as corrections (default 200). */
  maxCorrectionLength?: number
  /** Injectable clock for deterministic tests (defaults to Date.now). */
  now?: () => number
}

export interface BehaviorRuntime {
  note(record: ObservationRecord): void
  reject(signature: string): void
  /** Current promoted candidates (already the durable projection's source of truth). */
  candidates(): CandidateBehavior[]
}

/**
 * Stitch the pure observer to its durable projection. Candidates in
 * `candidates.json` are recomputed wholesale from the observation log on
 * every note — small N, and the file can never drift from the truth.
 */
export function createBehaviorRuntime(options: BehaviorOptions = {}): BehaviorRuntime | undefined {
  if (options.enabled !== true) return undefined

  const store = new BehaviorStore(options.root)
  const observer = new BehaviorObserver({ threshold: options.threshold, now: options.now })
  observer.hydrate(store.loadObservations(), store.loadTombstones())
  // Rebuild the projection on boot too: the file may be stale (crash between
  // append and last sync) and thresholds may have changed.
  store.saveCandidates(observer.candidates())

  const sync = (): void => {
    store.saveCandidates(observer.candidates())
  }

  return {
    note(record): void {
      observer.note(record)
      store.appendObservation(record)
      sync()
    },
    reject(signature): void {
      observer.reject(signature)
      store.saveTombstones([...new Set([...store.loadTombstones(), signature])])
      sync()
    },
    candidates: () => observer.candidates(),
  }
}

export const DEFAULT_CORRECTION_PHRASES = [
  '又', '还是不对', '我说过', '别再', '不对', '改错', 'again', 'still wrong',
  'i said', 'stop', "didn't i", 'wrong again', 'keep forgetting',
]

export const DEFAULT_MAX_CORRECTION_LENGTH = 200

/** Deterministic correction heuristic — low precision by design, user gate follows. */
export function detectCorrection(
  text: string,
  options: BehaviorOptions = {},
): string | undefined {
  const phrases = options.correctionPhrases ?? DEFAULT_CORRECTION_PHRASES
  const max = options.maxCorrectionLength ?? DEFAULT_MAX_CORRECTION_LENGTH
  if (text.length === 0 || text.length > max) return undefined
  const lowered = text.toLowerCase()
  const phrase = phrases.find(candidate => lowered.includes(candidate.toLowerCase()))
  return phrase === undefined ? undefined : correctionSignature(text)
}
