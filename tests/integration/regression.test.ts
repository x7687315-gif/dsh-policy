import { describe, expect, it } from 'vitest'
import { dshPolicy } from '../../src/plugin/index.ts'
import { validatePolicyDocument } from '../../src/policy/validator.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { textResponse } from './mock-adapter.ts'
import { buildStack, editCall, turnEndPayloads, userSay } from './stack.ts'

/**
 * Stage 9 regression tests — each pins a defect found in the code review:
 *
 * 1. The remediation budget never reset across turns: one exhausting turn
 *    stripped every later turn of its remediation chances.
 * 2. The root-scope system-prompt registration was never unregistered on
 *    plugin dispose: stale rule text kept being injected, and a re-applied
 *    plugin with a DIFFERENT policy silently kept showing the OLD rules
 *    (explanation diverging from enforcement, plan §11.3).
 * 3. A denyTools rule without `trigger: "always"` passed validation but was
 *    never enforced — a silent no-op, the exact thing layer 1 must avoid.
 */

const POLICY: PolicyDocument = {
  project: 'regression',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

function policyWithRuleId(id: string): PolicyDocument {
  return { project: 'regression', policy: { hard: [{ id, trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] } }
}

/** Remediation messages this plugin injected into the agent's inbox. */
function remediationInjections(agent: Agent, sinceSeq = 0): number {
  return agent.session.events.filter(event =>
    event.seq > sinceSeq
    && event.type === 'agent/inbox/spliced'
    && (event.data as { inserted?: { source?: { kind?: string; plugin?: string } }[] }).inserted
      ?.some(message => message.source?.kind === 'plugin' && message.source?.plugin === 'dsh-policy'),
  ).length
}

/** dsh-policy rule text the system-prompt plugin materialized for the CURRENT turn. */
function policyContextText(agent: Agent, sinceSeq: number): string {
  return agent.session.events
    .filter(event => event.seq > sinceSeq && event.type === 'user/message')
    .filter(event => (event.data as { source?: { plugin?: string } }).source?.plugin === '@deepseek-ai/dsh-system-prompt')
    .flatMap(event => ((event.data as { content?: { type: string; text?: string }[] }).content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? ''))
    .join('\n')
}

describe('defect 3 — denyTools rules must declare trigger: "always"', () => {
  it('rejects a denyTools rule without an explicit always trigger', () => {
    const result = validatePolicyDocument({
      project: 'x',
      policy: { hard: [{ id: 'd', denyTools: ['rm'], enforcement: 'hard' }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('always')
  })
})

it('defect 1 — the remediation budget resets for every new turn', async () => {
  const { agent, adapter, ctx } = await buildStack([
    // Turn 1: edit + three "done" attempts → two injections, then the hard throw.
    editCall(),
    textResponse('done (1)'),
    textResponse('done (2)'),
    textResponse('done (3)'),
    // Turn 2 (fresh budget): edit + three more attempts → two MORE injections, then throw.
    editCall(),
    textResponse('done (4)'),
    textResponse('done (5)'),
    textResponse('done (6)'),
  ], { policy: POLICY })

  userSay(agent, 'change the code (turn 1)')
  await agent.whenIdle().catch(() => {})
  const turn1Injections = remediationInjections(agent)
  const turn1End = turnEndPayloads(agent).at(-1)?.reason
  expect(JSON.stringify(turn1End)).toContain('error') // budget exhausted → refused

  userSay(agent, 'change the code again (turn 2)')
  await agent.whenIdle().catch(() => {})

  // The OLD code let turn 2 inherit the exhausted budget (0 injections, 2
  // requests). With the per-turn budget turn 2 gets its own two chances.
  expect(remediationInjections(agent)).toBe(turn1Injections + 2)
  expect(adapter.requests).toHaveLength(8)
  expect(JSON.stringify(turnEndPayloads(agent).at(-1)?.reason)).toContain('error')
  await ctx.fiber.dispose()
})

it('defect 2 — disposing the plugin removes its rule text; a re-applied plugin shows the NEW rules', async () => {
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('one'), textResponse('two')],
    {},
    false, // mount manually below
  )

  const fiberA = await ctx.plugin(dshPolicy, { policy: policyWithRuleId('rule-a') })
  const seqBeforeTurn1 = agent.session.events.length
  userSay(agent, 'hello (policy A)')
  await agent.whenIdle().catch(() => {})
  expect(policyContextText(agent, seqBeforeTurn1)).toContain('rule-a')

  await fiberA.dispose()

  const fiberB = await ctx.plugin(dshPolicy, { policy: policyWithRuleId('rule-b') })
  const seqBeforeTurn2 = agent.session.events.length
  userSay(agent, 'hello again (policy B)')
  await agent.whenIdle().catch(() => {})

  // Fresh registration succeeds (old code: duplicate name swallowed → the
  // model kept seeing rule-a) AND the old text is gone from the new context.
  const text = policyContextText(agent, seqBeforeTurn2)
  expect(text).toContain('rule-b')
  expect(text).not.toContain('rule-a')
  expect(adapter.requests).toHaveLength(2)
  await fiberB.dispose()
  await ctx.fiber.dispose()
})
