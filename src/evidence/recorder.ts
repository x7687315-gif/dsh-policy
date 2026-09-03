import type { PolicyEvent } from './events.ts'

/**
 * Per-agent evidence store. The adapter records normalized events here as
 * tools execute; the constraint engine reads them at the turn boundary.
 * Evidence is observation only — recording never mutates policy or user state.
 *
 * Timestamps are made STRICTLY increasing at record time: wall-clock
 * `Date.now()` has millisecond resolution, and on a fast in-memory stack a
 * code change and its subsequent passing test can land in the same
 * millisecond — the engine's `at > since` comparison would then wrongly treat
 * the passing run as pre-change and BLOCK a compliant turn (found by the
 * Stage 16 benchmark, case compliant-r2-n8). The +1 logical increment
 * preserves causal order without changing the event shape.
 */
export class EvidenceRecorder {
  readonly #events: PolicyEvent[] = []
  #lastAt = Number.NEGATIVE_INFINITY

  record(event: PolicyEvent): void {
    const at = event.at <= this.#lastAt ? this.#lastAt + 1 : event.at
    this.#lastAt = at
    this.#events.push({ ...event, at })
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
