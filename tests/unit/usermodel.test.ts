import { buildStack, editCall, userSay } from "../integration/stack.ts"
import { textResponse } from "../integration/mock-adapter.ts"
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CandidateBehavior } from '../../src/behavior/types.ts'
import { guardsFromUserModel } from '../../src/usermodel/guards.ts'
import { UserModelError, UserModelStore, auditPathFor } from '../../src/usermodel/store.ts'
import { applyReview } from '../../src/review/review.ts'
import type { ConfirmRequest } from '../../src/usermodel/schema.ts'

const REQUEST: ConfirmRequest = { via: 'review-cli', note: 'test' }

function candidate(overrides: Partial<CandidateBehavior>): CandidateBehavior {
  return {
    id: 'candidate:remediation_repeated:r1',
    kind: 'remediation_repeated',
    signature: 'remediation_repeated:r1',
    occurrences: 2,
    distinctSessions: 2,
    firstSeen: 1,
    lastSeen: 2,
    confidence: 0.75,
    draftMessage: 'Consider guidance: check callers after API changes.',
    status: 'candidate',
    evidence: [{ sessionId: 'a', at: 1, detail: '' }],
    ...overrides,
  }
}

describe('UserModelStore', () => {
  it('create/update/disable/delete all require the confirm request and write the audit trail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-um-'))
    const store = new UserModelStore(join(dir, 'user-model.json'), () => 5_000)
    try {
      const record = store.create(
        { kind: 'behavior_pattern', value: { message: 'check callers', trigger: { always: true } }, candidateId: 'candidate:x' },
        REQUEST,
      )
      expect(record.provenance).toMatchObject({ confirmedBy: 'user', candidateId: 'candidate:x' })
      expect(record.enabled).toBe(true)

      store.update(record.id, { value: { message: 'check callers FIRST', trigger: { always: true } } }, REQUEST)
      store.disable(record.id, REQUEST)
      expect(store.records()[0]?.enabled).toBe(false)

      store.delete(record.id, REQUEST)
      expect(store.records()).toHaveLength(0)

      // Four mutations → four audit entries, in order, naming the actor.
      const audit = readFileSync(auditPathFor(join(dir, 'user-model.json')), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      expect(audit.map(entry => entry.op)).toEqual(['create', 'update', 'disable', 'delete'])
      expect(audit.every(entry => entry.actor === 'user' && entry.via === 'review-cli')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('survives restarts, and a corrupt file fails loudly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-um-'))
    const path = join(dir, 'user-model.json')
    try {
      const store = new UserModelStore(path, () => 5_000)
      store.create({ kind: 'preference', value: { text: 'prefer async/await' } }, REQUEST)

      expect(new UserModelStore(path, () => 5_000).records()[0]?.value).toEqual({ text: 'prefer async/await' })

      writeFileSync(path, '{ corrupt')
      expect(() => new UserModelStore(path).records()).toThrow(UserModelError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unknown ids are loud, not silent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-um-'))
    try {
      const store = new UserModelStore(join(dir, 'user-model.json'))
      expect(() => store.delete('um-nope', REQUEST)).toThrow(/unknown record/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('applyReview', () => {
  it('confirm creates a durable record with provenance; reject tombstones; skip is a no-op', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-review-'))
    const store = new UserModelStore(join(dir, 'user-model.json'), () => 5_000)
    try {
      const candidates = [
        candidate({}),
        candidate({ id: 'candidate:tool_denied_repeated:rm', kind: 'tool_denied_repeated', signature: 'tool_denied_repeated:rm' }),
      ]
      const rejections: string[] = []
      const outcomes = applyReview(candidates, store, [
        { candidateId: candidates[0]!.id, action: 'edit', message: 'Run the test suite before saying done.' },
        { candidateId: candidates[1]!.id, action: 'reject' },
        { candidateId: candidates[1]!.id, action: 'skip' },
        { candidateId: 'candidate:ghost', action: 'confirm' },
      ], REQUEST, { onReject: signature => rejections.push(signature) })

      expect(outcomes.map(outcome => outcome.result)).toEqual(['record-created', 'tombstoned', 'skipped', 'unknown-candidate'])
      expect(rejections).toEqual(['tool_denied_repeated:rm'])

      const record = store.records()[0]!
      expect(record.kind).toBe('behavior_pattern')
      expect((record.value as { message: string }).message).toBe('Run the test suite before saying done.')
      expect(record.provenance.candidateId).toBe(candidates[0]!.id)

      // The durable record projects back into a plugin guard.
      const guard = guardsFromUserModel(store.records())[0]!
      expect(guard.id).toBe(`guard:${record.id}`)
      expect(guard.message).toBe('Run the test suite before saying done.')
      expect(guard.trigger).toEqual({ always: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

it('disabled records do not project into guards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-um-disable-'))
  const store = new UserModelStore(join(dir, 'user-model.json'), () => 5_000)
  try {
    const record = store.create({ kind: 'behavior_pattern', value: { message: 'm', trigger: { always: true } } }, REQUEST)
    expect(guardsFromUserModel(store.records())).toHaveLength(1)
    store.disable(record.id, REQUEST)
    expect(guardsFromUserModel(store.records())).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('plugin read path', () => {
  it('the plugin reads the user model read-only and gains the guard', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'dsh-um-live-'))
    try {
      const modelPath = join(dir, 'user-model.json')
      const store = new UserModelStore(modelPath, () => 5_000)
      store.create({ kind: 'behavior_pattern', value: { message: 'Check the affected callers.', trigger: { tools: ['edit_file'] } }, candidateId: 'candidate:live' }, REQUEST)
      const auditLinesBefore = readFileSync(auditPathFor(modelPath), 'utf8').trim().split('\n').length

      const { agent, adapter, ctx } = await buildStack(
        [editCall(), textResponse('done')],
        { policy: { project: 'um', policy: { hard: [] } }, userModelPath: modelPath },
      )
            userSay(agent, 'change the code')
      await agent.whenIdle().catch(() => {})

      // The user-confirmed guard rode the accepted edit result as a reminder.
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('Check the affected callers.')
      // The plugin never wrote to the model file (read-only consumption):
      // the audit trail has exactly the one entry the test's own create made.
      const auditLinesAfter = readFileSync(auditPathFor(modelPath), 'utf8').trim().split('\n').length
      expect(auditLinesAfter).toBe(auditLinesBefore)
      await ctx.fiber.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

