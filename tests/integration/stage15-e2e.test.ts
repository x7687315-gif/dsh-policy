import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStack, userSay, turnEndReasons, editCall } from './stack.ts'
import { textResponse, toolCallResponse } from './mock-adapter.ts'
import { CANDIDATES_FILE } from '../../src/behavior/store.ts'
import type { CandidateBehavior } from '../../src/behavior/types.ts'
import { createBehaviorRuntime } from '../../src/behavior/wire.ts'
import { UserModelStore } from '../../src/usermodel/store.ts'
import { applyReview } from '../../src/review/review.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

const EMPTY: PolicyDocument = { project: 'e2e', policy: { hard: [] } }
const HARD_TESTS: PolicyDocument = {
  project: 'e2e',
  policy: { hard: [{ id: 'tests-must-pass', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

/**
 * Flatten the raw text of every assembled request's messages. We assert
 * against this (not `JSON.stringify(requests)`) because `JSON.stringify`
 * escapes inner double quotes, which would break substring matches against
 * guard/preference text that contains quoted rule ids.
 */
function requestTexts(requests: readonly unknown[]): string {
  return requests
    .map(req => {
      const messages = (req as { messages?: { content?: { text?: string }[] }[] }).messages ?? []
      return messages.flatMap(m => (m.content ?? []).map(c => (c as { text?: string }).text ?? '')).join('\n')
    })
    .join('\n')
}

/**
 * Stage 15 §8.2 — Scenario A-E end-to-end acceptance over the REAL Harness
 * stack (ScriptedAdapter, zero GPU). Each scenario maps 1:1 to the roadmap
 * table; assertions are at the request/fact level, never on model prose.
 */
describe('Stage 15 — Scenario A-E end-to-end (roadmap §8.2)', () => {
  it('A — hard rule: block → remediate → pass full chain', async () => {
    const stack = await buildStack(
      [editCall(), toolCallResponse('c2', 'run_tests', {}), textResponse('done, tests pass')],
      { policy: HARD_TESTS },
    )
    userSay(stack.agent, 'change the code')
    await stack.agent.whenIdle().catch(() => {})

    expect(stack.forbidden.executed).toBe(false) // no forbidden tool in play
    expect(turnEndReasons(stack.agent)).toEqual(['completed']) // eventually passed
    // The block occurred: the remediation re-opened the turn (≥2 LLM requests)
    // and the hard-rule text was re-injected after the first violation.
    expect(stack.adapter.requests.length).toBeGreaterThanOrEqual(2)
    expect(stack.adapter.requests.some(r => JSON.stringify(r).includes('tests_pass'))).toBe(true)
    await stack.ctx.fiber.dispose()
  }, 20_000)

  it('B — behavior observation → CLI confirm → durable guard (tombstone + provenance)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-b-'))
    const modelPath = join(root, 'user-model.json')
    try {
      // Two separate sessions (as if two processes) each forget the tests once.
      for (const sid of ['b-a', 'b-b']) {
        const stack = await buildStack(
          [editCall(), textResponse('done (forgot the tests)')],
          { policy: HARD_TESTS, behavior: { enabled: true, root } },
          true,
          sid,
        )
        userSay(stack.agent, 'change the code')
        await stack.agent.whenIdle().catch(() => {})
        await stack.ctx.fiber.dispose()
      }

      const candidates = JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
      const candidate = candidates.find(c => c.signature === 'remediation_repeated:tests-must-pass')!
      expect(candidate).toBeDefined()
      expect(candidate.occurrences).toBe(2)
      expect(candidate.distinctSessions).toBe(2)
      expect(candidate.evidence.length).toBe(2) // provenance-complete

      // CLI confirm → durable guard (the single write path).
      const store = new UserModelStore(modelPath)
      const outcomes = applyReview(
        [candidate],
        store,
        [{ candidateId: candidate.id, action: 'confirm' }],
        { via: 'review-cli', note: 'Scenario B' },
      )
      expect(outcomes[0]!.result).toBe('record-created')

      const records = store.records()
      expect(records).toHaveLength(1)
      expect(records[0]!.kind).toBe('behavior_pattern')
      expect(records[0]!.provenance.confirmedBy).toBe('user')
      expect(records[0]!.provenance.candidateId).toBe(candidate.id)
      expect(records[0]!.provenance.confirmedAt).toBeGreaterThan(0)
      const guardMessage = (records[0]!.value as { message: string }).message

      // A fresh session consuming the user model → guard injected + persistent.
      const stack2 = await buildStack([textResponse('hello')], { policy: HARD_TESTS, userModelPath: modelPath })
      userSay(stack2.agent, 'say hi')
      await stack2.agent.whenIdle()
      // Compare against raw message text (JSON.stringify would escape the
      // quoted rule id inside the guard message).
      expect(requestTexts([stack2.adapter.requests[0]!])).toContain(guardMessage) // order 910
      // Read-only consumption: the model file is unchanged after the session.
      expect(existsSync(modelPath)).toBe(true)
      expect(new UserModelStore(modelPath).records()).toHaveLength(1)
      await stack2.ctx.fiber.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('C — confirmed preference injected for relevant task, not for irrelevant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-c-'))
    const modelPath = join(root, 'user-model.json')
    try {
      const store = new UserModelStore(modelPath)
      store.create(
        { kind: 'preference', value: { text: 'TS 任务：用接口约束参数', appliesTo: { taskRegex: 'typescript' } } },
        { via: 'review-cli', note: 'Scenario C' },
      )

      // Relevant task (message matches taskRegex) → preference injected (920).
      // The user/message event lands AFTER the first assembly, so the
      // taskRegex preference appears from the second assembly onward (mirrors
      // the guard timing, see preference.test.ts); assert across the history.
      const s1 = await buildStack([textResponse('ok'), textResponse('ok again')], { policy: EMPTY, userModelPath: modelPath })
      userSay(s1.agent, 'refactor this typescript module')
      await s1.agent.whenIdle().catch(() => {})
      userSay(s1.agent, 'and rename the typescript helpers')
      await s1.agent.whenIdle().catch(() => {})
      expect(requestTexts(s1.adapter.requests)).toContain('TS 任务：用接口约束参数')
      await s1.ctx.fiber.dispose()

      // Irrelevant task → preference must NOT leak into the prompt.
      const s2 = await buildStack([textResponse('ok'), textResponse('ok again')], { policy: EMPTY, userModelPath: modelPath })
      userSay(s2.agent, 'write a haiku about the moon')
      await s2.agent.whenIdle().catch(() => {})
      userSay(s2.agent, 'and another poem')
      await s2.agent.whenIdle().catch(() => {})
      expect(requestTexts(s2.adapter.requests)).not.toContain('TS 任务：用接口约束参数')
      await s2.ctx.fiber.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('D — authority boundary: rejected candidate leaves User Model unchanged (file-level), and does not resurrect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-d-'))
    const modelPath = join(root, 'user-model.json')
    try {
      for (const sid of ['d-a', 'd-b']) {
        const stack = await buildStack(
          [editCall(), textResponse('done (forgot tests)')],
          { policy: HARD_TESTS, behavior: { enabled: true, root } },
          true,
          sid,
        )
        userSay(stack.agent, 'change the code')
        await stack.agent.whenIdle().catch(() => {})
        await stack.ctx.fiber.dispose()
      }
      const candidates = JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
      const candidate = candidates.find(c => c.signature === 'remediation_repeated:tests-must-pass')!

      // Reject through the same pure pipeline the CLI uses.
      const behavior = createBehaviorRuntime({ enabled: true, root })
      const outcomes = applyReview(
        [candidate],
        new UserModelStore(modelPath),
        [{ candidateId: candidate.id, action: 'reject' }],
        { via: 'review-cli', note: 'Scenario D' },
        { onReject: signature => behavior?.reject(signature) },
      )
      expect(outcomes[0]!.result).toBe('tombstoned')

      // File-level assertion: NO user model file was ever written (authority intact).
      expect(existsSync(modelPath)).toBe(false)

      // Rejected not resurrect: a fresh runtime on the same root will not
      // re-promote the tombstoned signature.
      const fresh = createBehaviorRuntime({ enabled: true, root })!
      expect(fresh.candidates().some(c => c.signature === candidate.signature)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('E — project A/B scopes do not cross-talk', async () => {
    const regDir = mkdtempSync(join(tmpdir(), 'dsh-e-reg-'))
    const regPath = join(regDir, 'project-registry.json')
    writeFileSync(regPath, JSON.stringify({ projects: { A: { state: 'active' }, B: { state: 'active' } } }))

    const POLICY_A: PolicyDocument = {
      project: 'A',
      policy: { hard: [{ id: 'no-drop', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' }] },
    }
    const POLICY_B: PolicyDocument = {
      project: 'B',
      policy: { hard: [{ id: 'tests-must-pass', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
    }
    try {
      // A denies drop_database.
      const a = await buildStack(
        [toolCallResponse('c1', 'drop_database', {}), textResponse('tried')],
        { policy: POLICY_A, projectId: 'A', projectRegistryPath: regPath },
      )
      userSay(a.agent, 'drop the db')
      await a.agent.whenIdle().catch(() => {})
      expect(a.forbidden.executed).toBe(false) // denied in A
      const aReq = JSON.stringify(a.adapter.requests)
      expect(aReq).toContain('no-drop')
      expect(aReq).not.toContain('tests-must-pass') // B's rule never leaked into A
      await a.ctx.fiber.dispose()

      // B allows drop_database (A's deny did NOT leak) and enforces its own rule.
      const b = await buildStack(
        [toolCallResponse('c1', 'drop_database', {}), textResponse('tried')],
        { policy: POLICY_B, projectId: 'B', projectRegistryPath: regPath },
      )
      userSay(b.agent, 'drop the db')
      await b.agent.whenIdle().catch(() => {})
      expect(b.forbidden.executed).toBe(true) // allowed in B
      const bReq = JSON.stringify(b.adapter.requests)
      expect(bReq).toContain('tests-must-pass')
      expect(bReq).not.toContain('no-drop') // A's rule never leaked into B
      await b.ctx.fiber.dispose()

      // B's own hard gate is active: code change without a test → remediation fires.
      const b2 = await buildStack(
        [editCall(), textResponse('done without tests')],
        { policy: POLICY_B, projectId: 'B', projectRegistryPath: regPath },
      )
      userSay(b2.agent, 'change the code')
      await b2.agent.whenIdle().catch(() => {})
      expect(b2.adapter.requests.some(r => JSON.stringify(r).includes('tests_pass'))).toBe(true)
      await b2.ctx.fiber.dispose()
    } finally {
      rmSync(regDir, { recursive: true, force: true })
    }
  }, 30_000)
})
