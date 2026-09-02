import type { EvidenceRecorder } from '../evidence/recorder.ts'
import type { PolicyDocument } from '../policy/schema.ts'
import { DEFAULT_REMEDIATION } from '../policy/schema.ts'

export interface Violation {
  ruleId: string
  requirement: string
  reason: string
  remediation: string
}

export type Evaluation =
  | { status: 'PASS'; violations: [] }
  | { status: 'BLOCK'; violations: Violation[] }

/**
 * Pure policy evaluation: `evaluate(rules, evidence) → PASS | BLOCK`.
 * No Harness types, no I/O, fully deterministic — this is the part the four
 * POC tests pin down at engine level (plan §Phase 2).
 */
export function evaluatePolicy(policy: PolicyDocument, evidence: EvidenceRecorder): Evaluation {
  const violations: Violation[] = []

  for (const rule of policy.policy.hard) {
    // v0 understands exactly one trigger/requirement pair; the validator
    // rejects anything else before it can reach this point.
    if (rule.trigger === 'code_change' && rule.require === 'tests_pass') {
      const changedAt = evidence.lastCodeChangeAt()
      if (changedAt === undefined) continue // trigger never fired → rule not armed
      if (!evidence.hasPassingTestSince(changedAt)) {
        violations.push({
          ruleId: rule.id,
          requirement: rule.require,
          reason: `code changed (at ${new Date(changedAt).toISOString()}) without a passing test run afterwards`,
          remediation: rule.remediation ?? DEFAULT_REMEDIATION,
        })
      }
    }
  }

  return violations.length === 0
    ? { status: 'PASS', violations: [] }
    : { status: 'BLOCK', violations }
}
