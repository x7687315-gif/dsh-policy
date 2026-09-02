import { expect, it } from 'vitest'
import { buildStack, turnEndReasons, userSay } from './stack.ts'
import { textResponse } from './mock-adapter.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

const EMPTY_POLICY: PolicyDocument = { project: 'smoke', policy: { hard: [] } }

it('boots the real Harness stack with the dsh-policy plugin and completes a plain turn', async () => {
  const { agent, adapter, ctx } = await buildStack([textResponse('hello from the mock')], { policy: EMPTY_POLICY })

  userSay(agent, 'say hi')
  await agent.whenIdle()

  expect(turnEndReasons(agent)).toEqual(['completed'])
  expect(adapter.requests).toHaveLength(1)
  await ctx.fiber.dispose()
})
