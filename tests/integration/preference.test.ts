import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { PolicyDocument } from '../../src/policy/schema.ts'
import type { ResolvedPreference } from '../../src/usermodel/preferences.ts'
import { UserModelStore, auditPathFor } from '../../src/usermodel/store.ts'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, testCall, turnEndPayloads, userSay } from './stack.ts'

/**
 * Stage 13 — Preference layer + Context Resolver (plan §Phase 11-12, roadmap §6).
 * Preferences are contextual, non-blocking soft guidance injected at order 920.
 */

const EMPTY_POLICY: PolicyDocument = { project: 'prefs', policy: { hard: [] } }

const HARD_POLICY: PolicyDocument = {
  project: 'prefs',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

function pf(over: Partial<ResolvedPreference> & { id: string; text: string }): ResolvedPreference {
  return { priority: 50, recency: 1, ...over }
}

function readLines(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

it('relevant preference is injected, irrelevant stays out (roadmap §6.3)', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('ok'), textResponse('ok again'), textResponse('ok third')],
    {
      policy: EMPTY_POLICY,
      preferences: [
        pf({ id: 'p-api', text: 'Use async/await for the API layer', appliesTo: { taskRegex: 'api' } }),
        pf({ id: 'p-db', text: 'Review diffs before touching the database', appliesTo: { taskRegex: 'database' } }),
      ],
    },
  )

  // Two turns: the taskRegex preference matches only from the second assembly
  // onward (the user/message event lands after the first assembly), mirroring
  // the guard timing. So we assert across the whole request history.
  userSay(agent, 'update the api client')
  await agent.whenIdle().catch(() => {})
  userSay(agent, 'and rename the api module')
  await agent.whenIdle().catch(() => {})

  const seen = JSON.stringify(adapter.requests)
  expect(seen).toContain('Use async/await for the API layer')
  expect(seen).not.toContain('Review diffs before touching the database')
  await ctx.fiber.dispose()
})

it('NON-BLOCKING INVARIANT: preference is guidance, never a rule — turn still enforces hard policy', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), testCall(), textResponse('all green')],
    {
      policy: HARD_POLICY,
      preferences: [pf({ id: 'p1', text: 'Use async/await', appliesTo: {} })],
    },
  )

  userSay(agent, 'change the code and test it')
  await agent.whenIdle().catch(() => {})

  // Satisfied hard rule → completion; the preference rides along as guidance.
  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  expect(JSON.stringify(adapter.requests)).toContain('Use async/await')

  // The preference id can never surface as a violation reason.
  expect(JSON.stringify(turnEndPayloads(agent))).not.toContain('p1')
  await ctx.fiber.dispose()
})

it('preference never grants a pass: hard violation still blocks with the pref present', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), textResponse('done')],
    {
      policy: HARD_POLICY,
      preferences: [pf({ id: 'p1', text: 'Use async/await', appliesTo: {} })],
      maxRemediations: 1,
    },
  )

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  // The pref is injected as guidance AND the hard rule still refuses the turn.
  expect(JSON.stringify(adapter.requests)).toContain('Use async/await')
  expect(turnEndPayloads(agent).at(-1)?.reason).not.toMatchObject({ kind: 'completed' })
  await ctx.fiber.dispose()
})

it('HMR safety: disposing the plugin fiber removes the preference text', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('ok'), textResponse('ok again')],
    { policy: EMPTY_POLICY, preferences: [pf({ id: 'p1', text: 'Use async/await', appliesTo: {} })] },
  )

  userSay(agent, 'refactor the api module')
  await agent.whenIdle().catch(() => {})
  expect(JSON.stringify(adapter.requests)).toContain('Use async/await')

  await ctx.fiber.dispose()

  const { agent: agent2, adapter: adapter2, ctx: ctx2 } = await buildStack(
    [textResponse('ok')],
    { policy: EMPTY_POLICY, preferences: [] },
  )
  userSay(agent2, 'refactor the api module')
  await agent2.whenIdle().catch(() => {})
  expect(JSON.stringify(adapter2.requests)).not.toContain('Use async/await')
  await ctx2.fiber.dispose()
})

it('read-only consumption: the plugin injects the preference but never writes the user model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pref-live-'))
  try {
    const modelPath = join(dir, 'user-model.json')
    const store = new UserModelStore(modelPath, () => 5_000)
    store.create({ kind: 'preference', value: { text: 'Use async/await', appliesTo: {} } }, { via: 'review-cli', note: 'test' })
    const auditBefore = readLines(auditPathFor(modelPath))

    const { agent, adapter, ctx } = await buildStack(
      [editCall(), textResponse('done')],
      { policy: { project: 'um', policy: { hard: [] } }, userModelPath: modelPath },
    )
    userSay(agent, 'change the code')
    await agent.whenIdle().catch(() => {})

    expect(JSON.stringify(adapter.requests)).toContain('Use async/await')
    expect(readLines(auditPathFor(modelPath))).toBe(auditBefore) // plugin wrote nothing
    await ctx.fiber.dispose()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('first-round timing: a taskRegex preference appears from the second assembly onward', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('ok'), textResponse('ok again')],
    { policy: EMPTY_POLICY, preferences: [pf({ id: 'p1', text: 'Use async/await', appliesTo: { taskRegex: 'api' } })] },
  )

  // Turn 1: request[0] is built before the user/message event updates the task
  // text, so the taskRegex preference is absent there.
  userSay(agent, 'please refactor the api module')
  await agent.whenIdle().catch(() => {})
  expect(JSON.stringify(adapter.requests[0])).not.toContain('Use async/await')

  // Turn 2: the task text is now known, so the preference is injected.
  userSay(agent, 'and rename the api helpers')
  await agent.whenIdle().catch(() => {})
  expect(JSON.stringify(adapter.requests[1])).toContain('Use async/await')
  await ctx.fiber.dispose()
})
