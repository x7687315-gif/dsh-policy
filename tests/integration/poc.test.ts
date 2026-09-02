import { expect, it } from 'vitest'
import { textResponse, toolCallResponse } from './mock-adapter.ts'
import { buildStack, editCall, testCall, turnEndPayloads, userSay } from './stack.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

const POLICY: PolicyDocument = {
  project: 'my-api',
  policy: {
    hard: [{
      id: 'test-after-code-change',
      trigger: 'code_change',
      require: 'tests_pass',
      enforcement: 'hard',
    }],
  },
}

const options = { policy: POLICY, maxRemediations: 2, debug: false }

/**
 * The four POC cases from the project plan (§Phase 2 "Required tests").
 * Exit criterion: the Agent cannot successfully finish while violating the
 * hard Project Policy — proven against the real loop, session, and tool
 * registry with only the LLM adapter mocked.
 */

it('Case A: code changed + tests pass → the agent may complete', async () => {
  const { agent, adapter, ctx } = await buildStack([
    editCall(),
    testCall(),
    textResponse('done — tests are green'),
  ], options)

  userSay(agent, 'rename the user export and make sure tests pass')
  await agent.whenIdle().catch(() => {})

  const reasons = turnEndPayloads(agent).map(event => event.reason)
  expect(reasons.at(-1)).toMatchObject({ kind: 'completed' })
  expect(adapter.requests).toHaveLength(3) // edit → run_tests → closing message
  await ctx.fiber.dispose()
})

it('Case B: code changed + tests fail → the agent cannot complete', async () => {
  const { agent, adapter, testSuite, ctx } = await buildStack([
    editCall(),
    testCall(),
    textResponse('i think we are done'),
    testCall('c3'),
    textResponse('still done'),
    testCall('c4'),
    textResponse('done for real'),
  ], options)
  testSuite.passing = false // the suite keeps failing no matter how often it runs

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  const last = turnEndPayloads(agent).at(-1)
  // Never completes: the turn can only end as an error naming the violated rule.
  expect(last?.reason).toMatchObject({ kind: 'error' })
  expect(JSON.stringify(last?.reason)).toContain('test-after-code-change')
  // Three failing runs (initial + 2 remediations) were forced by the checkpoint.
  expect(adapter.requests).toHaveLength(7)
  await ctx.fiber.dispose()
})

it('Case C: code changed + no tests → blocked first, completed after remediation', async () => {
  const { agent, adapter, ctx } = await buildStack([
    editCall(),
    textResponse('done (forgot the tests)'),
    // After the injected remediation the model runs the suite, then closes out.
    testCall(),
    textResponse('now the tests pass'),
  ], options)

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  // 4 requests: the checkpoint refused the first "done" and forced a test run.
  expect(adapter.requests).toHaveLength(4)
  await ctx.fiber.dispose()
})

it('Case D: no code change → the rule is not triggered', async () => {
  const { agent, adapter, ctx } = await buildStack([
    textResponse('just answering a question'),
  ], options)

  userSay(agent, 'explain the API without touching anything')
  await agent.whenIdle().catch(() => {})

  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  expect(adapter.requests).toHaveLength(1) // no forced extra steps
  await ctx.fiber.dispose()
})

it('policy violation surfaces as structured remediation injected into the inbox', async () => {
  const { agent, ctx } = await buildStack([
    editCall(),
    textResponse('done'),
    testCall(),
    textResponse('fixed'),
  ], options)

  userSay(agent, 'change the code')
  await agent.whenIdle().catch(() => {})

  const inboxEvents = agent.session.events.filter(event => event.type.startsWith('agent/inbox'))
  expect(inboxEvents.length).toBeGreaterThan(0)
  await ctx.fiber.dispose()
})

it('toolCallResponse helper produces valid scripted tool calls (sanity)', () => {
  const chunks = toolCallResponse('c9', 'edit_file', { path: 'a.ts' })
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
})
