import { expect, it } from 'vitest'
import { textResponse, toolCallResponse } from './mock-adapter.ts'
import { buildStack, editCall, testCall, turnEndPayloads, userSay } from './stack.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

/**
 * v1 capabilities on the real Harness stack:
 * multiple hard rules, MUST NOT (deny_tools) enforcement at tools/pre-execute,
 * and the model being TOLD the rules via the system prompt (plan §11.3).
 */

const TWO_RULES: PolicyDocument = {
  project: 'my-api',
  policy: {
    hard: [
      { id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' },
      { id: 'typecheck-required', trigger: 'code_change', require: { kind: 'tool_pass', tool: 'typecheck' }, enforcement: 'hard' },
    ],
  },
}

const DENY_RULE: PolicyDocument = {
  project: 'my-api',
  policy: {
    hard: [{ id: 'no-dangerous-commands', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' }],
  },
}

it('multiple hard rules: both verifications are required before completion', async () => {
  const { agent, adapter, ctx } = await buildStack([
    editCall(),
    toolCallResponse('c5', 'typecheck', {}),
    testCall(),
    textResponse('green on both checks'),
  ], { policy: TWO_RULES })

  userSay(agent, 'change the code, then typecheck and test')
  await agent.whenIdle().catch(() => {})

  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  expect(adapter.requests).toHaveLength(4)
  await ctx.fiber.dispose()
})

it('multiple hard rules: a missing typecheck blocks completion like a missing test', async () => {
  const { agent, testSuite, ctx } = await buildStack([
    editCall(),
    testCall(),
    textResponse('tests pass, skipping typecheck'),
    // Remediation injected → the model runs the typechecker, then closes out.
    toolCallResponse('c6', 'typecheck', {}),
    textResponse('now both are green'),
  ], { policy: TWO_RULES })
  testSuite.passing = true

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  await ctx.fiber.dispose()
})

it('MUST NOT rule: the forbidden tool body never executes and the call is denied', async () => {
  const { agent, adapter, forbidden, ctx } = await buildStack([
    toolCallResponse('c1', 'drop_database', {}),
    textResponse('understood — I will not touch the database'),
  ], { policy: DENY_RULE })
  expect(forbidden.executed).toBe(false)

  userSay(agent, 'clean up the production database')
  await agent.whenIdle().catch(() => {})

  // The call was denied before the body could run, the model saw the deny
  // reason, and the turn completed without any policy violation.
  expect(forbidden.executed).toBe(false)
  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  expect(adapter.requests).toHaveLength(2)
  await ctx.fiber.dispose()
})

it('the model is told the active rules via the system prompt (explanation ≠ enforcement)', async () => {
  const { agent, adapter, ctx } = await buildStack([
    textResponse('got it'),
  ], { policy: TWO_RULES })

  userSay(agent, 'hello')
  await agent.whenIdle().catch(() => {})

  // PromptContext materializes as a durable user-role snapshot appended to
  // the request messages (not the system slot) — the model sees it every step.
  const first = adapter.requests[0]
  const seen = JSON.stringify({ system: first?.system, messages: first?.messages })
  expect(seen).toContain('test-after-code-change')
  expect(seen).toContain('typecheck-required')
  expect(seen).toContain('runtime-enforced')
  await ctx.fiber.dispose()
})
