import type { PolicyEvent } from './events.ts'

/**
 * Per-agent evidence store. The adapter records normalized events here as
 * tools execute; the constraint engine reads them at the turn boundary.
 * Evidence is observation only — recording never mutates policy or user state.
 */
export class EvidenceRecorder {
  readonly #events: PolicyEvent[] = []

  record(event: PolicyEvent): void {
    this.#events.push(event)
  }

  events(): readonly PolicyEvent[] {
    return this.#events
  }

  /** Timestamp of the most recent code change, or undefined when none happened. */
  lastCodeChangeAt(): number | undefined {
    for (let i = this.#events.length - 1; i >= 0; i--) {
      const event = this.#events[i]
      if (event?.kind === 'code_change') return event.at
    }
    return undefined
  }

  /** Whether a passing run of `tool` was recorded strictly after `since`. */
  hasPassingToolRunSince(since: number, tool: string): boolean {
    return this.#events.some(
      event => event.kind === 'tool_pass' && event.tool === tool && event.passed && event.at > since,
    )
  }
}
