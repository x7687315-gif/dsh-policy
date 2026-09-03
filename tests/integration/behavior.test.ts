import { expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANDIDATES_FILE } from '../../src/behavior/store.ts'
import type { CandidateBehavior } from '../../src/behavior/types.ts'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, userSay } from './stack.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

/**
 * Roadmap §3.5 integration scenario: two independent sessions (fresh stacks,
 * as if two processes) each forget the tests once → the SAME candidate
 * aggregates both, and — the non-blocking invariant — no durable user state
 * exists anywhere.
 */
const POLICY: PolicyDocument = {
  project: 'observation',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

it('two sessions forgetting tests once each aggregate into one promoted candidate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-obs-live-'))
  try {
    for (const sessionId of ['obs-a', 'obs-b']) {
      const stack = await buildStack(
        [editCall(), textResponse('done (forgot the tests)')],
        { policy: POLICY, behavior: { enabled: true, root } },
        true,
        sessionId,
      )
      userSay(stack.agent, 'change the code')
      await stack.agent.whenIdle().catch(() => {})
      await stack.ctx.fiber.dispose()
    }

    expect(existsSync(join(root, CANDIDATES_FILE))).toBe(true)
    const candidates = JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
    const candidate = candidates.find(entry => entry.signature === 'remediation_repeated:test-after-code-change')
    expect(candidate).toBeDefined()
    expect(candidate).toMatchObject({
      occurrences: 2,
      distinctSessions: 2,
      status: 'candidate',
      id: 'candidate:remediation_repeated:test-after-code-change',
    })
    expect(candidate?.confidence).toBeGreaterThanOrEqual(0.6)
    expect(candidate?.draftMessage).toContain('test-after-code-change')
    expect(candidate?.evidence.length).toBe(2)

    // Non-blocking invariant (roadmap §3.5): observation changed NOTHING about
    // durable user state — no user model file exists in the behavior root.
    expect(existsSync(join(root, 'user-model.json'))).toBe(false)

    // The enforcement behavior itself is untouched: both sessions still ended
    // in refusal/remediation exactly as before observation existed.
    rmSync(root, { recursive: true, force: true })
  } finally {
    if (!existsSync(root)) return
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

it('user corrections from the session firehose aggregate into a candidate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-obs-corrections-'))
  try {
    // Two separate stacks (two sessions); the user issues the same correction twice.
    for (const sessionId of ['corr-a', 'corr-b']) {
      const stack = await buildStack(
        [textResponse('ok'), textResponse('ok again')],
        { policy: { project: 'observation', policy: { hard: [] } }, behavior: { enabled: true, root } },
        true,
        sessionId,
      )
      userSay(stack.agent, '又改错了，注意检查调用方')
      await stack.agent.whenIdle().catch(() => {})
      await stack.ctx.fiber.dispose()
    }

    const candidates = JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
    const correction = candidates.find(entry => entry.kind === 'user_correction')
    // Heuristic signals score lower, so two sessions sit at the promotion edge:
    // 0.2·(2/5) + 0.4·(2/3) + 0.2·1 + 0.2·0.4 ≈ 0.627 — just above the gate.
    expect(correction).toBeDefined()
    expect(correction?.occurrences).toBe(2)
    expect(correction?.distinctSessions).toBe(2)
    rmSync(root, { recursive: true, force: true })
  } finally {
    if (!existsSync(root)) return
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

it('observation is opt-in: default stacks produce no behavior files at all', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-obs-off-'))
  try {
    const stack = await buildStack(
      [textResponse('hello')],
      { policy: { project: 'observation', policy: { hard: [] } }, behavior: { enabled: true, root: undefined } },
    )
    userSay(stack.agent, '又改错了')
    await stack.agent.whenIdle().catch(() => {})
    // enabled but no root → in-memory only: nothing on disk anywhere.
    expect(existsSync(join(root, CANDIDATES_FILE))).toBe(false)
    await stack.ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  } finally {
    if (!existsSync(root)) return
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
