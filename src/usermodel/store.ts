import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditEntry, ConfirmRequest, UserModelFile, UserModelKind, UserModelRecord, UserModelValue } from './schema.ts'
import { USER_MODEL_VERSION } from './schema.ts'

export class UserModelError extends Error {
  constructor(message: string) {
    super(`dsh-policy user-model: ${message}`)
    this.name = 'UserModelError'
  }
}

export function auditPathFor(modelPath: string): string {
  return modelPath.replace(/\.json$/, '') + '.audit.jsonl'
}

/**
 * Durable user model store (plan §Phase 9).
 *
 * Invariants:
 * - SINGLE WRITE PATH: every mutation requires a ConfirmRequest — the call
 *   site must state that the USER authorized the change. The plugin runtime
 *   only ever reads (see guardsFromUserModel), so agent-driven durable
 *   mutation has no code path at all (plan §2.1, §11.7).
 * - Every mutation appends one audit entry to `<model>.audit.jsonl`; the
 *   model file itself is rewritten atomically (tmp + rename).
 * - Corrupt or future-version files fail LOUDLY: silently forgetting user
 *   rules would be worse than refusing to start.
 */
export class UserModelStore {
  constructor(readonly path: string, private readonly now: () => number = Date.now) {}

  #dir(): string {
    return dirname(this.path)
  }

  load(): UserModelFile {
    if (!existsSync(this.path)) return { version: USER_MODEL_VERSION, records: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (error) {
      throw new UserModelError(`corrupt model file: ${error instanceof Error ? error.message : String(error)}`)
    }
    const file = parsed as UserModelFile
    if (file.version !== USER_MODEL_VERSION || !Array.isArray(file.records)) {
      throw new UserModelError(`unsupported model version ${String((file as { version?: unknown }).version)} (expected ${USER_MODEL_VERSION})`)
    }
    return file
  }

  records(): UserModelRecord[] {
    return this.load().records
  }

  create(input: { kind: UserModelKind; value: UserModelValue; candidateId?: string }, request: ConfirmRequest): UserModelRecord {
    const now = this.now()
    const record: UserModelRecord = {
      id: `um-${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      value: structuredClone(input.value),
      scope: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      provenance: { candidateId: input.candidateId, confirmedAt: now, confirmedBy: 'user' },
    }
    this.#mutate('create', record.id, request, (file) => {
      file.records.push(record)
    })
    return record
  }

  update(id: string, patch: { value?: UserModelValue; enabled?: boolean }, request: ConfirmRequest): UserModelRecord {
    let updated: UserModelRecord | undefined
    this.#mutate('update', id, request, (file) => {
      const record = file.records.find(entry => entry.id === id)
      if (record === undefined) throw new UserModelError(`unknown record "${id}"`)
      if (patch.value !== undefined) record.value = structuredClone(patch.value)
      if (patch.enabled !== undefined) record.enabled = patch.enabled
      record.updatedAt = this.now()
      updated = record
    })
    return updated!
  }

  disable(id: string, request: ConfirmRequest): UserModelRecord {
    let disabled: UserModelRecord | undefined
    this.#mutate('disable', id, request, (file) => {
      const record = file.records.find(entry => entry.id === id)
      if (record === undefined) throw new UserModelError(`unknown record "${id}"`)
      record.enabled = false
      record.updatedAt = this.now()
      disabled = record
    })
    return disabled!
  }

  delete(id: string, request: ConfirmRequest): void {
    this.#mutate('delete', id, request, (file) => {
      const index = file.records.findIndex(entry => entry.id === id)
      if (index === -1) throw new UserModelError(`unknown record "${id}"`)
      file.records.splice(index, 1)
    })
  }

  #mutate(op: AuditEntry['op'], recordId: string, request: ConfirmRequest, mutate: (file: UserModelFile) => void): void {
    const file = this.load()
    mutate(file)
    mkdirSync(this.#dir(), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.path)
    const entry: AuditEntry = {
      at: this.now(),
      actor: 'user',
      op,
      recordId,
      via: request.via,
      note: request.note,
    }
    mkdirSync(this.#dir(), { recursive: true })
    appendFileSync(auditPathFor(this.path), `${JSON.stringify(entry)}\n`, 'utf8')
  }
}

/** Read a model file from disk without the store (plugin read path). */
export function readUserModel(path: string): UserModelRecord[] {
  return new UserModelStore(path).records()
}
