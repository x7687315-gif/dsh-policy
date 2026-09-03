import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HardRule, PolicyDocument } from '../../src/policy/schema.ts'
import type { ProjectRegistry } from '../../src/project/registry.ts'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, turnEndPayloads, userSay } from './stack.ts'

/**
 * Stage 14 — Scope merge + lifecycle + monotonicity, exercised through the real
 * Harness stack (roadmap §7.1 / §7.2). The plugin reads global (inline),
 * project (options), and task rules, applies the lifecycle registry, and fails
 * closed when a weaker scope tries to weaken a stronger one.
 */

const GLOBAL: PolicyDocument = {
  project: 'global',
  scope: 'global',
  policy: { hard: [{ id: 'g-forbid-drop', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' }] },
}
const PROJECT: PolicyDocument = {
  project: 'demo',
  scope: 'project',
  policy: { hard: [{ id: 'p-test-after-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}
const TASK: HardRule[] = [{ id: 't-forbid-format', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }]

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-lifecycle-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeRegistry(projects: ProjectRegistry['projects']): string {
  const path = join(dir, 'project-registry.json')
  writeFileSync(path, JSON.stringify({ projects }))
  return path
}

async function promptText(stack: Awaited<ReturnType<typeof buildStack>>): Promise<string> {
  userSay(stack.agent, 'working on the demo')
  await stack.agent.whenIdle().catch(() => {})
  return JSON.stringify(stack.adapter.requests)
}

describe('scope merge (global + project + task)', () => {
  it('all three scopes contribute rules to the injected prompt', async () => {
    const stack = await buildStack([textResponse('ok')], {
      globalPolicy: GLOBAL,
      policy: PROJECT,
      taskRules: TASK,
    })
    const prompt = await promptText(stack)
    expect(prompt).toContain('g-forbid-drop')
    expect(prompt).toContain('p-test-after-change')
    expect(prompt).toContain('t-forbid-format')
    await stack.ctx.fiber.dispose()
  })
})

describe('constraint monotonicity fail-closed', () => {
  it('rejects a task rule that disables a global hard rule', async () => {
    await expect(
      buildStack([textResponse('ok')], {
        globalPolicy: GLOBAL,
        policy: PROJECT,
        taskRules: [{ id: 'g-forbid-drop', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard', enabled: false }],
      }),
    ).rejects.toThrow(/constraint monotonicity/)
  })

  it('rejects a task rule that redefines a global hard rule', async () => {
    await expect(
      buildStack([textResponse('ok')], {
        globalPolicy: GLOBAL,
        policy: PROJECT,
        taskRules: [{ id: 'g-forbid-drop', trigger: 'always', denyTools: ['format_disk'], enforcement: 'hard' }],
      }),
    ).rejects.toThrow(/may only ADD rules, not weaken/)
  })
})

describe('project lifecycle', () => {
  it('active project rules ARE present in the prompt (control)', async () => {
    const registryPath = writeRegistry({ demo: { state: 'active' } })
    const stack = await buildStack([textResponse('ok')], {
      globalPolicy: GLOBAL,
      policy: PROJECT,
      projectId: 'demo',
      projectRegistryPath: registryPath,
    })
    const prompt = await promptText(stack)
    expect(prompt).toContain('p-test-after-change')
    expect(prompt).toContain('g-forbid-drop')
    await stack.ctx.fiber.dispose()
  })

  it('paused project rules are EXCLUDED from the prompt', async () => {
    const registryPath = writeRegistry({ demo: { state: 'paused' } })
    const stack = await buildStack([textResponse('ok')], {
      globalPolicy: GLOBAL,
      policy: PROJECT,
      projectId: 'demo',
      projectRegistryPath: registryPath,
    })
    const prompt = await promptText(stack)
    expect(prompt).not.toContain('p-test-after-change') // project rule leaked?
    expect(prompt).toContain('g-forbid-drop') // global still applies
    await stack.ctx.fiber.dispose()
  })

  it('archived project rules do not block turn-stopping', async () => {
    // The project rule would block a code change without a passing test run.
    // When archived, it is excluded, so the turn completes.
    const registryPath = writeRegistry({ demo: { state: 'archived' } })
    const stack = await buildStack([editCall(), textResponse('done')], {
      policy: PROJECT,
      projectId: 'demo',
      projectRegistryPath: registryPath,
    })
    userSay(stack.agent, 'change the code')
    await stack.agent.whenIdle().catch(() => {})
    expect(turnEndPayloads(stack.agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
    await stack.ctx.fiber.dispose()
  })

  it('active project rule still blocks turn-stopping (contrast with archived)', async () => {
    const registryPath = writeRegistry({ demo: { state: 'active' } })
    const stack = await buildStack([editCall(), textResponse('done')], {
      policy: PROJECT,
      projectId: 'demo',
      projectRegistryPath: registryPath,
      maxRemediations: 1,
    })
    userSay(stack.agent, 'change the code')
    await stack.agent.whenIdle().catch(() => {})
    expect(turnEndPayloads(stack.agent).at(-1)?.reason).not.toMatchObject({ kind: 'completed' })
    await stack.ctx.fiber.dispose()
  })
})
