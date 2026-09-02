/**
 * Normalized runtime evidence (plan §Phase 4). These records are produced from
 * observable tool executions — never from LLM claims — and are the only input
 * the constraint engine is allowed to reason about.
 */
export type PolicyEvent =
  | {
      kind: 'code_change'
      at: number
      /** Harness tool that performed the change. */
      tool: string
      detail: string
    }
  | {
      kind: 'tool_pass'
      at: number
      /** Verification tool that ran (run_tests, typecheck, …). */
      tool: string
      /** Derived from the tool's actual result value, not from model text. */
      passed: boolean
      detail: string
    }
  | {
      kind: 'tool_denied'
      at: number
      /** Tool whose execution was refused by a hard MUST NOT rule. */
      tool: string
      ruleId: string
    }
