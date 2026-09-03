import { expect, it } from 'vitest'
import type { BehaviorGuardRule } from '../../src/behavior/guard.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, testCall, turnEndPayloads, userSay } from './stack.ts'

/**
 * Stage 11 — Behavior Guard (plan §Phase 8, roadmap §4).
 * Guidance is contextual and NEVER blocking; the non-blocking invariant is
 * proven both ways below.
 */

const EMPTY_POLICY: PolicyDocument = { project: 'guards', policy: { hard: [] } }

const HARD_POLICY: PolicyDocument = {
  project: 'guards',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

const TOOL_GUARD: BehaviorGuardRule = {
  id: 'guard-check-callers',
  message: 'After changing the API, check the affected callers.',
  trigger: { tools: ['edit_file'] },
  severity: 'warn',
}

const TASK_GUARD: BehaviorGuardRule = {
  id: 'guard-small-diffs',
  message: 'Keep diffs small and focused.',
  trigger: { taskRegex: 'refactor|重构' },
}

const ALWAYS_GUARD: BehaviorGuardRule = {
  id: 'guard-commit-early',
  message: 'Commit early, commit often.',
  trigger: { always: true },
}

it('tool guard: the reminder rides the accepted tool result into the next request', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), textResponse('done')],
    { policy: EMPTY_POLICY, guards: [TOOL_GUARD, TASK_GUARD] },
  )

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  // Completed (guard cannot block) and the second request — built right after
  // the edit executed — carries the guard reminder as an additional context.
  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  const secondRequest = JSON.stringify(adapter.requests[1]?.messages ?? [])
  expect(secondRequest).toContain('check the affected callers')
  expect(secondRequest).toContain('guidance, not a rule')
  await ctx.fiber.dispose()
})

it('task guard + always guard render in the prompt assembly; unrelated guards stay out', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('ok'), textResponse('ok again')],
    { policy: EMPTY_POLICY, guards: [TASK_GUARD, ALWAYS_GUARD, TOOL_GUARD] },
  )

  // First message: the always guard is present. The taskRegex guard matches
  // against the LATEST user message, and the user/message event is appended
  // after the first assembly — so the task guard appears from the next
  // assembly onward (per-request dynamic text, durable snapshot projection).
  userSay(agent, 'please refactor the auth module')
  await agent.whenIdle().catch(() => {})
  expect(JSON.stringify(adapter.requests[0])).toContain('Commit early, commit often')

  userSay(agent, 'and now refactor the session layer')
  await agent.whenIdle().catch(() => {})
  const seen = JSON.stringify(adapter.requests[1])
  expect(seen).toContain('Commit early, commit often') // always guard
  expect(seen).toContain('Keep diffs small and focused') // taskRegex matched "refactor"
  expect(seen).not.toContain('check the affected callers') // tool guard ≠ prompt channel
  await ctx.fiber.dispose()
}, 20_000)

it('NON-BLOCKING INVARIANT: guards coexist with enforcement, and never become violations', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), textResponse('done'), testCall(), textResponse('fixed')],
    {
      policy: HARD_POLICY,
      guards: [TOOL_GUARD, ALWAYS_GUARD],
      maxRemediations: 1,
    },
  )

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  // The hard rule still did its job: the first "done" was refused and the
  // checkpoint forced an extra step (4 requests), completing only after the
  // test run — with guards present the whole time.
  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  expect(adapter.requests).toHaveLength(4)

  // Guidance is not a rule: no guard id can ever surface as a violation.
  const allTurnEnds = JSON.stringify(turnEndPayloads(agent))
  expect(allTurnEnds).not.toContain('guard-check-callers')
  expect(allTurnEnds).not.toContain('guard-commit-early')
  await ctx.fiber.dispose()
})

it('guards + satisfied hard rules → completion is unaffected by guidance', async () => {
  const { agent, ctx } = await buildStack(
    [editCall(), testCall(), textResponse('all green')],
    { policy: HARD_POLICY, guards: [TOOL_GUARD, ALWAYS_GUARD] },
  )

  userSay(agent, 'change the code and test it')
  await agent.whenIdle().catch(() => {})

  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  await ctx.fiber.dispose()
})

it('disabled guards contribute nothing', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), textResponse('done')],
    {
      policy: EMPTY_POLICY,
      guards: [{ ...TOOL_GUARD, enabled: false }, { ...ALWAYS_GUARD, enabled: false }],
    },
  )

  userSay(agent, 'refactor the module')
  await agent.whenIdle().catch(() => {})

  const seen = JSON.stringify(adapter.requests)
  expect(seen).not.toContain('check the affected callers')
  expect(seen).not.toContain('Commit early, commit often')
  await ctx.fiber.dispose()
})
