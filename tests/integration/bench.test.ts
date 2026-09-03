import { describe, expect, it } from 'vitest'
import {
  runConstraintMatrix,
  runRemediationCase,
  summarizeConstraint,
  runPreferenceMatrix,
  runReminderAppearances,
  runTokenDeltaMatrix,
} from '../../bench/matrix.ts'
import type { ConstraintCaseResult } from '../../bench/matrix.ts'

/**
 * Stage 16 — the benchmark's headline rates are PINNED here so the claims in
 * bench/report.json cannot silently regress. Reduced matrix keeps CI fast;
 * `pnpm bench` runs the full sweep for report.json.
 *
 * These tests encode plan §Phase 18's hard targets:
 * - violation detection 100%, false-block 0%, false-pass 0% (deterministic
 *   replay corpus, real Harness stack, scripted adapter as the only mock);
 * - remediation success 100%;
 * - ZERO extra model calls on compliant/no-change turns (the zero-extra-LLM
 *   call MVP assertion from plan §Phase 18);
 * - per-turn prompt overhead bounded by the 800-token budget;
 * - preference relevance precision/recall 100% on the documented matrix;
 * - guard reminder delivery 100%.
 */

const RULES = [1, 2]
const NOISE = [0, 8]

describe('constraint effectiveness (plan §Phase 18)', () => {
  it('detects every violation, never blocks a compliant turn, never passes a violation', async () => {
    const results: ConstraintCaseResult[] = await runConstraintMatrix(RULES, NOISE, 4000)
    const summary = summarizeConstraint(results)
    expect(summary.detectionRate).toBe(1)
    expect(summary.falseBlockRate).toBe(0)
    expect(summary.falsePassRate).toBe(0)
    expect(summary.completionCorrectness).toBe(1)
    expect(summary.cases).toBe(RULES.length * NOISE.length * 4)
  }, 60_000)

  it('remediation succeeds: refuse → inject → pass → complete', async () => {
    const outcome = await runRemediationCase(2, 4000)
    expect(outcome.success).toBe(true)
    // edit + 2 failing verifies + closing + 2 passing verifies + closing = 7
    expect(outcome.requests).toBe(outcome.expectedRequests)
    expect(outcome.requests).toBe(7)
  }, 30_000)

  it('ZERO extra model calls on compliant and no-change turns', async () => {
    const deltas = await runTokenDeltaMatrix(RULES, NOISE, 4000)
    for (const sample of deltas) {
      expect(sample.withRequests).toBe(sample.withoutRequests)
    }
  }, 60_000)

  it('per-request prompt overhead stays positive and bounded (≤ 400 tokens for ≤ 2 rules)', async () => {
    const deltas = await runTokenDeltaMatrix(RULES, NOISE, 4000)
    for (const sample of deltas) {
      expect(sample.deltaTokensPerRequest).toBeGreaterThan(0)
      expect(sample.deltaTokensPerRequest).toBeLessThanOrEqual(400)
    }
  }, 60_000)
})

describe('personalization effectiveness (deterministic proxies)', () => {
  it('preference relevance: precision and recall are 100% on the documented matrix', () => {
    const { precision, recall, cells } = runPreferenceMatrix()
    expect(cells).toHaveLength(16)
    expect(precision).toBe(1)
    expect(recall).toBe(1)
  })

  it('guard reminder delivery: 100% of matching tool results carry the reminder', async () => {
    const { rate } = await runReminderAppearances(3, 4000)
    expect(rate).toBe(1)
  }, 30_000)
})
