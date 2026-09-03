import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CandidateBehavior, ObservationRecord } from './types.ts'

export const OBSERVATIONS_FILE = 'observations.jsonl'
export const TOMBSTONES_FILE = 'tombstones.json'
export const CANDIDATES_FILE = 'candidates.json'

/**
 * Durable projection for the observation engine (same JSONL/append-only
 * philosophy as the evidence store):
 * - `observations.jsonl` — append-only observation log (crash-tolerant reads);
 * - `tombstones.json`    — rejected signatures (a rejected candidate must
 *                          never silently reappear, plan §Phase 10);
 * - `candidates.json`    — the full promoted-candidate list, rewritten
 *                          atomically (tmp file + rename) on every sync.
 *
 * All operations are no-ops when `root` is undefined (in-memory mode).
 */
export class BehaviorStore {
  constructor(readonly root: string | undefined) {}

  appendObservation(record: ObservationRecord): void {
    if (this.root === undefined) return
    const file = this.#file(OBSERVATIONS_FILE)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  }

  loadObservations(): ObservationRecord[] {
    if (this.root === undefined) return []
    const file = this.#file(OBSERVATIONS_FILE)
    if (!existsSync(file)) return []
    const records: ObservationRecord[] = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue
      try {
        records.push(JSON.parse(line) as ObservationRecord)
      } catch {
        // torn trailing line from a crash mid-append — skip it
      }
    }
    return records
  }

  loadTombstones(): string[] {
    return this.#readJson<string[]>(TOMBSTONES_FILE, [])
  }

  saveTombstones(signatures: readonly string[]): void {
    this.#writeJsonAtomic(TOMBSTONES_FILE, signatures)
  }

  loadCandidates(): CandidateBehavior[] {
    return this.#readJson<CandidateBehavior[]>(CANDIDATES_FILE, [])
  }

  /** Full atomic rewrite — the candidate list is small and recomputed wholesale. */
  saveCandidates(candidates: readonly CandidateBehavior[]): void {
    this.#writeJsonAtomic(CANDIDATES_FILE, candidates)
  }

  #file(name: string): string {
    return join(this.root ?? '', name)
  }

  #readJson<T>(name: string, fallback: T): T {
    if (this.root === undefined) return fallback
    const file = this.#file(name)
    if (!existsSync(file)) return fallback
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return fallback // corrupt file must not kill the session
    }
  }

  #writeJsonAtomic(name: string, value: unknown): void {
    if (this.root === undefined) return
    const file = this.#file(name)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  }
}
