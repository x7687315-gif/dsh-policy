import { describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlEvidenceStore } from '../../src/evidence/store.ts'
import { dshPolicy } from '../../src/plugin/index.ts'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, turnEndPayloads, userSay } from './stack.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'

const POLICY: PolicyDocument = {
  project: 'persistence',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

describe('JsonlEvidenceStore', () => {
  it('persists evidence to one JSONL file per session and rehydrates it', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))
    try {
      const first = new JsonlEvidenceStore(root)
      first.record('session-a', { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' })
      first.record('session-a', { kind: 'tool_pass', at: 200, tool: 'run_tests', passed: false, detail: '' })
      first.record('session-b', { kind: 'tool_pass', at: 150, tool: 'run_tests', passed: true, detail: '' })

      const file = join(root, 'session-a.jsonl')
      expect(existsSync(file)).toBe(true)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0] ?? '{}').sessionId).toBe('session-a')

      // A NEW store instance (process restart) rehydrates the same session.
      const second = new JsonlEvidenceStore(root)
      const events = second.events('session-a')
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ kind: 'code_change' })
      // ...and does not leak another session's events.
      expect(second.events('session-b')).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('tolerates torn trailing lines from a crash mid-append', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))
    try {
      const store = new JsonlEvidenceStore(root)
      store.record('s', { kind: 'code_change', at: 1, tool: 'edit_file', detail: '' })
      appendFileSync(store.fileFor('s'), '{"sessionId":"s","event":{"kind":"code_ch') // torn write
      expect(new JsonlEvidenceStore(root).events('s')).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

it('a resumed session keeps its unremediated violation (persisted evidence gates a fresh process)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-live-'))
  try {
    // Turn 1: edit code without tests — evidence lands in the JSONL file.
    const first = await buildStack(
      [editCall(), textResponse('done')],
      { policy: POLICY, evidenceRoot: root },
      true,
      'resume-test',
    )
    userSay(first.agent, 'change the code')
    await first.agent.whenIdle().catch(() => {})
    expect(existsSync(join(root, 'resume-test.jsonl'))).toBe(true)
    await first.ctx.fiber.dispose()

    // Turn 2: a brand-new stack (fresh process), SAME session id. The gate
    // must still remember the unremediated code change from the file.
    const second = await buildStack(
      [textResponse('nothing to see here')],
      { policy: POLICY, evidenceRoot: root },
      true,
      'resume-test',
    )
    userSay(second.agent, 'anything')
    await second.agent.whenIdle().catch(() => {})
    // Never completes: the hydrated evidence re-arms the rule.
    expect(JSON.stringify(turnEndPayloads(second.agent).at(-1)?.reason)).not.toContain('"completed"')
    await second.ctx.fiber.dispose()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('disposing the plugin fiber unwinds enforcement and allows clean re-apply (HMR safety)', async () => {
  const { ctx, agent, adapter } = await buildStack(
    [
      editCall(),
      textResponse('done without tests (1)'),
      textResponse('done without tests (2)'),
      textResponse('no code change, free to finish'),
      editCall(),
      textResponse('done without tests (3)'),
    ],
    { policy: POLICY },
    false, // do NOT mount the policy plugin yet
  )

  // With the plugin mounted, an unremediated change cannot complete silently.
  const fiber = await ctx.plugin(dshPolicy, { policy: POLICY })
  userSay(agent, 'change the code (attempt 1)')
  await agent.whenIdle().catch(() => {})
  expect(JSON.stringify(turnEndPayloads(agent).at(-1)?.reason)).not.toContain('"completed"')

  // Dispose the contributing fiber — every policy effect must unwind.
  await fiber.dispose()

  // The same kind of turn now completes: no gate is listening.
  userSay(agent, 'chat only (plugin disposed)')
  await agent.whenIdle().catch(() => {})
  expect(turnEndPayloads(agent).at(-1)?.reason).toMatchObject({ kind: 'completed' })
  const afterDispose = adapter.requests.length

  // Re-apply works (no duplicate-name crash) and gates again.
  await ctx.plugin(dshPolicy, { policy: POLICY })
  userSay(agent, 'change the code (attempt 3, plugin re-applied)')
  await agent.whenIdle().catch(() => {})
  expect(adapter.requests.length).toBeGreaterThan(afterDispose)
  expect(JSON.stringify(turnEndPayloads(agent).at(-1)?.reason)).not.toContain('"completed"')
  await ctx.fiber.dispose()
})
