import type { EvidenceRecorder } from '../evidence/recorder.ts'
import type { ToolPassRule } from '../policy/schema.ts'
import { DEFAULT_REMEDIATION, requireTool } from '../policy/schema.ts'
import type { Resolution } from '../policy/resolver.ts'

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
 * Pure policy evaluation over the resolved rule set:
 * `evaluate(rules, evidence) → PASS | BLOCK`.
 *
 * Only `ToolPassRule`s are judged here — they are the rules whose evidence
 * exists at the turn boundary. `DenyToolsRule`s are enforced earlier, at
 * `tools/pre-execute`, so a denied call never even happens.
 *
 * No Harness types, no I/O, fully deterministic.
 */
export function evaluatePolicy(resolution: Resolution, evidence: EvidenceRecorder): Evaluation {
  const violations: Violation[] = []

  for (const rule of resolution.rules) {
    if (rule.trigger !== 'code_change') continue // denyTools rules: pre-execute gate
    const passRule = rule as ToolPassRule
    const tool = requireTool(passRule)

    const changedAt = evidence.lastCodeChangeAt()
    if (changedAt === undefined) continue // trigger never fired → rule not armed

    if (!evidence.hasPassingToolRunSince(changedAt, tool)) {
      const requirement = typeof passRule.require === 'string' ? passRule.require : `tool_pass:${tool}`
      violations.push({
        ruleId: passRule.id,
        requirement,
        reason: `code changed (at ${new Date(changedAt).toISOString()}) without a passing "${tool}" run afterwards`,
        remediation: passRule.remediation
          ?? (requirement === 'tests_pass' ? DEFAULT_REMEDIATION : `Hard project policy violated: run "${tool}" and make it pass before finishing.`),
      })
    }
  }

  return violations.length === 0
    ? { status: 'PASS', violations: [] }
    : { status: 'BLOCK', violations }
}
