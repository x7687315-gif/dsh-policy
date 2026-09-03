import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CandidateBehavior } from '../../src/behavior/types.ts'
import { applyReview } from '../../src/review/review.ts'
import { preferencesFromUserModel } from '../../src/usermodel/preferences.ts'
import { UserModelStore } from '../../src/usermodel/store.ts'
import type { ConfirmRequest } from '../../src/usermodel/schema.ts'

const REQUEST: ConfirmRequest = { via: 'review-cli', note: 'test' }

function candidate(overrides: Partial<CandidateBehavior>): CandidateBehavior {
  return {
    id: 'candidate:remediation_repeated:r1',
    kind: 'remediation_repeated',
    signature: 'remediation_repeated:r1',
    occurrences: 2,
    distinctSessions: 2,
    firstSeen: 1,
    lastSeen: 2,
    confidence: 0.75,
    draftMessage: 'Consider guidance: check callers after API changes.',
    status: 'candidate',
    evidence: [{ sessionId: 'a', at: 1, detail: '' }],
    ...overrides,
  }
}

describe('applyReview — preference emission (Stage 13)', () => {
  it('confirm with as:"preference" writes a kind:"preference" record through the single ConfirmRequest path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-review-pref-'))
    const store = new UserModelStore(join(dir, 'user-model.json'), () => 5_000)
    try {
      const candidates = [candidate({})]
      const outcomes = applyReview(
        candidates,
        store,
        [{
          candidateId: candidates[0]!.id,
          action: 'confirm',
          as: 'preference',
          preferenceValue: { text: 'Prefer async/await', kind: 'style', appliesTo: { taskRegex: 'api' }, priority: 80 },
        }],
        REQUEST,
      )

      expect(outcomes[0]!.result).toBe('record-created')
      const record = store.records()[0]!
      expect(record.kind).toBe('preference')
      expect(record.value).toMatchObject({ text: 'Prefer async/await', kind: 'style', appliesTo: { taskRegex: 'api' }, priority: 80 })
      expect(record.provenance).toMatchObject({ confirmedBy: 'user' })

      // The durable record projects back into a resolver preference input.
      const projected = preferencesFromUserModel(store.records())
      expect(projected).toHaveLength(1)
      expect(projected[0]!.text).toBe('Prefer async/await')
      expect(projected[0]!.priority).toBe(80)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('default confirm (no `as`) still creates a behavior_pattern — no regression', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-review-pref2-'))
    const store = new UserModelStore(join(dir, 'user-model.json'), () => 5_000)
    try {
      const candidates = [candidate({})]
      applyReview(candidates, store, [{ candidateId: candidates[0]!.id, action: 'confirm' }], REQUEST)
      expect(store.records()[0]!.kind).toBe('behavior_pattern')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
