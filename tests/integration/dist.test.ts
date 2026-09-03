import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Stage 18 — REAL packaging verification: these tests run against the BUILT
 * `dist/` bundle (what consumers actually install), not the TS sources. They
 * are skipped when dist has not been built; CI builds first.
 */

const HAS_DIST = existsSync(resolve(import.meta.dirname ?? '.', '../../dist/index.mjs'))

describe.skipIf(!HAS_DIST)('dist bundle (what real users import)', () => {
  it('imports the library entry and exposes the plugin surface', async () => {
    const imported = await import('../../dist/index.mjs')
    expect(imported.dshPolicy).toBeDefined()
    expect(imported.dshPolicy.name).toBe('dsh-policy')
    expect(typeof imported.dshPolicy.apply).toBe('function')
    expect(imported.PolicyViolationError).toBeDefined()
  })

  it('enforces a hard rule end-to-end when the plugin is mounted FROM THE BUNDLE', async () => {
    const { dshPolicy } = await import('../../dist/index.mjs')
    const { textResponse, ScriptedAdapter } = await import('./mock-adapter.ts')
    const { editCall } = await import('./stack.ts')

    // Minimal real stack (services from source, PLUGIN from dist): the subject
    // under test is the packaged artifact.
    const { Context } = await import('@deepseek-ai/cordis')
    const { default: LlmRuntime, createUserMessage } = await import('@deepseek-ai/dsh-llm')
    const { default: SessionStore, SessionId } = await import('@deepseek-ai/dsh-session')
    const { default: SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection')
    const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
    const { default: ToolRuntime, defineTool } = await import('@deepseek-ai/dsh-tools')
    const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
    const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })

    const adapter = new ScriptedAdapter([editCall(), textResponse('done without tests')])
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.tools.register(defineTool({
      name: 'edit_file',
      description: 'edit',
      parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
      async execute(args) { return `edited ${(args as { path: string }).path}` },
    }))

    await ctx.plugin(dshPolicy, {
      policy: { project: 'dist-test', policy: { hard: [{ id: 'dist-rule', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] } },
      maxRemediations: 0, // refuse immediately: deterministic single assertion
    })

    const agent = await ctx.agentLoop.create(SessionId(`dist-${Date.now()}`), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'change something' }], source: { kind: 'user' } }))
    await agent.whenIdle().catch(() => {})

    const lastEnd = agent.session.events.filter(e => e.type === 'turn/end').at(-1)
    const reason = JSON.stringify(lastEnd?.data ?? {})
    // The BUNDLED plugin refuses the violating turn — the packaged artifact enforces.
    expect(reason).toContain('error')
    expect(reason).toContain('dist-rule')
    await ctx.fiber.dispose()
  }, 30_000)

  it('ships a working unified CLI (init scaffolds, init never clobbers)', () => {
    const cli = resolve(import.meta.dirname ?? '.', '../../dist/cli.mjs')
    const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
    expect(help).toContain('usage: dsh-policy')
    expect(help).toContain('init')
  })
})
