/**
 * dsh-policy demo — proves the core thesis end to end:
 *
 *   code changed → no passing test event → BLOCK → remediation injected
 *   → model runs tests → tests pass → PASS → the turn may complete.
 *
 * Real Harness stack, scripted LLM adapter (no API key, no local inference).
 * Run with: pnpm demo
 */
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { dshPolicy } from '../src/plugin/index.ts'
import { ScriptedAdapter, textResponse, toolCallResponse } from '../tests/integration/mock-adapter.ts'

const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(SessionStore)
await ctx.plugin(SessionProjectionRegistry)
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [] })

const adapter = new ScriptedAdapter([
  toolCallResponse('c1', 'edit_file', { path: 'src/api/user.ts', content: '...' }),
  textResponse('done (forgot the tests)'),
  toolCallResponse('c2', 'run_tests', {}),
  textResponse('tests are green now'),
])
ctx.llm.registerAdapter(['mock'], adapter)

ctx.tools.register(defineTool({
  name: 'edit_file',
  description: 'Edit a project source file.',
  parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute(args) { return `edited ${args.path}` },
}))
ctx.tools.register(defineTool({
  name: 'run_tests',
  description: 'Run the project test suite.',
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute() { return 'ALL TESTS PASSED (12)' },
}))

await ctx.plugin(dshPolicy, {
  policy: {
    project: 'my-api',
    policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
  },
  debug: true,
})

const agent = await ctx.agentLoop.create(SessionId('demo'), { provider: 'mock', model: 'mock' })
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'change the code' }], source: { kind: 'user' } }))
await agent.whenIdle()

const lastTurnEnd = agent.session.events.filter(event => event.type === 'turn/end').at(-1)
console.log('\n=== RESULT ===')
console.log('turn/end reason:', JSON.stringify(lastTurnEnd?.data, null, 2))
console.log('model requests :', adapter.requests.length, '(4 = completion was blocked once and remediation forced a test run)')
await ctx.fiber.dispose()
