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
      kind: 'test_run'
      at: number
      /** Harness tool that executed the tests. */
      tool: string
      /** Derived from the tool's actual result value, not from model text. */
      passed: boolean
      detail: string
    }
