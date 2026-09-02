import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { dshPolicy, type DshPolicyOptions } from '../../src/plugin/index.ts'
import { ScriptedAdapter, toolCallResponse } from './mock-adapter.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

export { SessionId, createUserMessage }

export interface TestStack {
  ctx: Context
  adapter: ScriptedAdapter
  testSuite: { passing: boolean }
  agent: Agent
}

export function turnEndReasons(agent: Agent): string[] {
  return agent.session.events
    .filter(event => event.type === 'turn/end')
    .map(event => (event.data as { reason: { kind: string } }).reason.kind)
}

export function turnEndPayloads(agent: Agent): { turn: number; reason: unknown }[] {
  return agent.session.events
    .filter(event => event.type === 'turn/end')
    .map(event => event.data as { turn: number; reason: unknown })
}

/**
 * Boot the real Harness stack (loop + session + system-prompt + tools +
 * registry) with the scripted adapter as the only mock, register the two POC
 * tools, and apply the dsh-policy plugin. Mirrors the official
 * `packages/core/agent-loop/tests/agent.spec.ts` harness.
 */
export async function buildStack(
  script: StreamChunk[][],
  policyOptions: DshPolicyOptions = {},
): Promise<TestStack> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })

  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)

  const testSuite = { passing: true }
  ctx.tools.register(defineTool({
    name: 'edit_file',
    description: 'Edit a project source file.',
    parameters: {
      path: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `edited ${args.path}`
    },
  }))
  ctx.tools.register(defineTool({
    name: 'run_tests',
    description: 'Run the project test suite.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return testSuite.passing ? 'ALL TESTS PASSED (12)' : 'TESTS FAILED: 2 failing'
    },
  }))

  await ctx.plugin(dshPolicy, policyOptions)

  const agent = await ctx.agentLoop.create(SessionId(`dsh-policy-test-${Math.random().toString(36).slice(2, 8)}`), {
    provider: 'mock',
    model: 'mock',
  })

  return { ctx, adapter, testSuite, agent }
}

export function userSay(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

export const editCall = (path = 'src/api/user.ts') => toolCallResponse('c1', 'edit_file', { path, content: 'export const user = 1' })
export const testCall = (id = 'c2') => toolCallResponse(id, 'run_tests', {})
