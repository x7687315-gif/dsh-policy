import type { ObservationKind } from './types.ts'

/**
 * How trustworthy the signal class is, independent of frequency:
 * - enforcement facts our own runtime produced are ground truth (1.0 / 0.9);
 * - heuristics over user text are weak (0.4) — they only ever become
 *   candidates, never durable state (the user decides in Stage 12).
 */
export const SIGNAL_QUALITY: Record<ObservationKind, number> = {
  remediation_repeated: 1.0,
  hard_block_repeated: 1.0,
  tool_denied_repeated: 0.9,
  test_fail_streak: 0.6,
  user_correction: 0.4,
}

export interface ConfidenceInput {
  kind: ObservationKind
  occurrences: number
  distinctSessions: number
  lastSeenAt: number
  now: number
}

/**
 * Deterministic confidence in [0,1] (roadmap §3.4):
 *
 *   0.2 · min(occurrences,5)/5        — frequency (capped: 50 repeats ≈ 5)
 * + 0.4 · min(distinctSessions,3)/3   — breadth across sessions (the strong term)
 * + 0.2 · exp(-daysSinceLastSeen/14)  — recency, two-week half-life-ish decay
 * + 0.2 · signalQuality               — trustworthiness of the signal class
 *
 * Reference points (useful for tests):
 *   1 occurrence, 1 session, fresh, runtime-proof  → 0.573  (never promotes)
 *   2 occurrences, 2 sessions, fresh, runtime-proof → 0.747  (promotes)
 *   2 occurrences, 2 sessions, 60d stale            → 0.550  (recency kills it)
 */
export function confidenceOf(input: ConfidenceInput): number {
  const occurrences = 0.2 * Math.min(input.occurrences, 5) / 5
  const sessions = 0.4 * Math.min(input.distinctSessions, 3) / 3
  const days = Math.max(0, (input.now - input.lastSeenAt) / 86_400_000)
  const recency = 0.2 * Math.exp(-days / 14)
  return Math.min(1, occurrences + sessions + recency + 0.2 * SIGNAL_QUALITY[input.kind])
}
