import { describe, expect, it } from 'vitest'
import { evaluateTurn, PolicyViolationError } from '../../src/plugin/index.ts'
import type { EvidenceRecorder } from '../../src/evidence/recorder.ts'
import { resolvePolicies } from '../../src/policy/resolver.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

/**
 * R2 (F-04c): the turn-boundary policy gate is fail-closed. If the evaluation
 * itself throws — corrupt evidence, unexpected internal error — the turn must
 * be REFUSED, never silently completed. This guards the HARD constraint's
 * BLOCK power from being lost to an unhandled exception.
 */
const validPolicy: PolicyDocument = {
  project: 'x',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

function throwingRecorder(): EvidenceRecorder {
  return {
    record: () => {},
    events: () => [],
    lastCodeChangeAt: () => { throw new Error('corrupt evidence store') },
    hasPassingToolRunSince: () => false,
  } as unknown as EvidenceRecorder
}

describe('turn-boundary evaluation is fail-closed (R2)', () => {
  it('a throwing evaluation refuses the turn (PolicyViolationError), never silently passes', () => {
    const resolution = resolvePolicies([{ scope: 'project', document: validPolicy }])
    expect(() => evaluateTurn(resolution, throwingRecorder())).toThrow(PolicyViolationError)
  })

  it('a normal PASS is still returned unchanged (no behavior change on the happy path)', () => {
    const resolution = resolvePolicies([{ scope: 'project', document: validPolicy }])
    const recorder = {
      record: () => {},
      events: () => [],
      lastCodeChangeAt: () => undefined,
      hasPassingToolRunSince: () => false,
    } as unknown as EvidenceRecorder
    const evaluation = evaluateTurn(resolution, recorder)
    expect(evaluation.status).toBe('PASS')
  })
})
