import type { BehaviorGuardTrigger } from '../behavior/guard.ts'
import type { CandidateBehavior } from '../behavior/types.ts'
import type { BehaviorPatternValue, ConfirmRequest, PreferenceValue } from '../usermodel/schema.ts'
import type { UserModelStore } from '../usermodel/store.ts'

export type ReviewAction = 'confirm' | 'edit' | 'reject' | 'skip'

export interface ReviewDecision {
  candidateId: string
  action: ReviewAction
  /** For 'edit': the user-revised reminder message. */
  message?: string
  /**
   * Stage 13: emit a `preference` record instead of a `behavior_pattern`.
   * The CLI/UI owns the choice (and authors `preferenceValue`); this function
   * stays deterministic and keeps the single `UserModelStore` write path.
   */
  as?: 'behavior_pattern' | 'preference'
  /** Required when `as === 'preference'`: the authored preference content. */
  preferenceValue?: PreferenceValue
}

export type ReviewResult =
  | 'record-created'
  | 'tombstoned'
  | 'skipped'
  | 'unknown-candidate'

export interface ReviewOutcome {
  candidateId: string
  action: ReviewAction
  result: ReviewResult
  recordId?: string
}

/**
 * Derive a sensible default guard trigger from the candidate's kind. The
 * user can refine the message at review time; trigger refinement is a
 * later CLI concern (roadmap §5).
 */
function triggerFromCandidate(candidate: CandidateBehavior): BehaviorGuardTrigger {
  if (candidate.kind === 'tool_denied_repeated') return { always: true }
  return { always: true }
}

/**
 * The review pipeline, as pure logic over (candidates, decisions, store):
 * confirm  → durable UserModelRecord + guard projection
 * edit     → same, with the user-revised message
 * reject   → signature tombstone (the candidate can never reappear)
 * skip     → no-op (candidate stays pending)
 *
 * The caller (CLI / UI) owns the confirm request and any side channels
 * (e.g. behavior runtime rejection) — this function stays deterministic.
 */
export function applyReview(
  candidates: readonly CandidateBehavior[],
  store: UserModelStore,
  decisions: readonly ReviewDecision[],
  request: ConfirmRequest,
  hooks: { onReject?: (signature: string) => void } = {},
): ReviewOutcome[] {
  const outcomes: ReviewOutcome[] = []

  for (const decision of decisions) {
    const candidate = candidates.find(entry => entry.id === decision.candidateId)
    if (candidate === undefined) {
      outcomes.push({ candidateId: decision.candidateId, action: decision.action, result: 'unknown-candidate' })
      continue
    }

    switch (decision.action) {
    case 'confirm':
    case 'edit': {
      if (decision.as === 'preference') {
        // Soft preference: same `ConfirmRequest` boundary, same single write
        // path — it is a `UserModelRecord` of `kind: 'preference'`, projected
        // into prompts (never into the constraint engine).
        const value: PreferenceValue = decision.preferenceValue
          ?? { text: decision.message ?? candidate.draftMessage }
        const record = store.create({ kind: 'preference', value }, request)
        outcomes.push({ candidateId: candidate.id, action: decision.action, result: 'record-created', recordId: record.id })
        break
      }
      const value: BehaviorPatternValue = {
        message: decision.action === 'edit' ? decision.message ?? candidate.draftMessage : candidate.draftMessage,
        trigger: triggerFromCandidate(candidate),
      }
      const record = store.create(
        { kind: 'behavior_pattern', value, candidateId: candidate.id },
        request,
      )
      outcomes.push({ candidateId: candidate.id, action: decision.action, result: 'record-created', recordId: record.id })
      break
    }
      case 'reject': {
        hooks.onReject?.(candidate.signature)
        outcomes.push({ candidateId: candidate.id, action: decision.action, result: 'tombstoned' })
        break
      }
      case 'skip': {
        outcomes.push({ candidateId: candidate.id, action: decision.action, result: 'skipped' })
        break
      }
    }
  }

  return outcomes
}
