import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PolicyEvent } from './events.ts'
import { EvidenceRecorder } from './recorder.ts'

export interface StoredEvidence {
  sessionId: string
  event: PolicyEvent
}

/**
 * Durable evidence store (plan §Phase 4 "event/session correlation" +
 * "record tool results").
 *
 * - Evidence is keyed by SESSION: a fresh session starts clean, a RESUMED
 *   session keeps its previously recorded evidence (the gate must not forget
 *   an unremediated violation just because the process restarted).
 * - When `root` is set, every record is appended to
 *   `<root>/<session-id>.jsonl` (one JSON object per line, diff-friendly,
 *   replayable) and hydrated back into memory on first touch.
 * - When `root` is undefined the store is purely in-memory.
 */
export class JsonlEvidenceStore {
  readonly #recorders = new Map<string, EvidenceRecorder>()

  constructor(readonly root: string | undefined) {}

  recorderFor(sessionId: string): EvidenceRecorder {
    let recorder = this.#recorders.get(sessionId)
    if (recorder === undefined) {
      recorder = new EvidenceRecorder()
      this.#hydrate(sessionId, recorder)
      this.#recorders.set(sessionId, recorder)
    }
    return recorder
  }

  record(sessionId: string, event: PolicyEvent): void {
    this.recorderFor(sessionId).record(event)
    if (this.root !== undefined) {
      const file = this.fileFor(sessionId)
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify({ sessionId, event } satisfies StoredEvidence)}\n`, 'utf8')
    }
  }

  events(sessionId: string): readonly PolicyEvent[] {
    return this.recorderFor(sessionId).events()
  }

  fileFor(sessionId: string): string {
    return join(this.root ?? '', `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`)
  }

  #hydrate(sessionId: string, recorder: EvidenceRecorder): void {
    if (this.root === undefined) return
    const file = this.fileFor(sessionId)
    if (!existsSync(file)) return
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const stored = JSON.parse(line) as StoredEvidence
        if (stored.sessionId === sessionId) recorder.record(stored.event)
      } catch {
        // A torn trailing line (crash mid-append) must never kill the session.
      }
    }
  }
}
