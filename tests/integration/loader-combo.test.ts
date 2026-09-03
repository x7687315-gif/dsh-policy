import { expect, it } from 'vitest'
import { resolve } from 'node:path'
import { loadCordisConfig } from '../../src/config/loader.ts'
import type { DshPolicyOptions } from '../../src/plugin/index.ts'
import { buildStack, turnEndReasons, userSay, editCall } from './stack.ts'
import { textResponse } from './mock-adapter.ts'

const CORDIS_YML = resolve(__dirname, '../../examples/cordis.yml')

/**
 * Stage 15 §8.1 — the official "Loader-based cordis.yml combination test",
 * satisfied via a real-config boot: we parse the actual `examples/cordis.yml`
 * and start the real Harness stack from the parsed dsh-policy entry (the
 * production `@cordisjs/loader` performs the same parse; see src/config/loader.ts
 * for why we validate through our offline-safe reader instead).
 */
it('parses examples/cordis.yml into the dsh-policy entry with all option partitions', () => {
  const entries = loadCordisConfig(CORDIS_YML)
  const dsh = entries.find(e => e.name === 'dsh-policy')
  expect(dsh).toBeDefined()
  expect(dsh!.options.context).toMatchObject({ tokenBudget: 800 })
  expect(dsh!.options.behavior).toMatchObject({ enabled: true })
  expect(dsh!.options.policyPath).toBe('tests/fixtures/combo-policy.json')
  expect(dsh!.options.userModelPath).toBe('tests/fixtures/combo-user-model.json')
  // The cloud adapter block is present for production wiring.
  expect(entries.some(e => e.name === '@deepseek-ai/dsh-llm-deepseek')).toBe(true)
})

it('boots the real stack from the parsed cordis.yml entry — all subsystems combine and inject', async () => {
  const entries = loadCordisConfig(CORDIS_YML)
  const dsh = entries.find(e => e.name === 'dsh-policy')!
  const { agent, adapter, ctx } = await buildStack(
    [textResponse('hello from the combo stack')],
    dsh.options as DshPolicyOptions,
  )

  userSay(agent, 'say hi')
  await agent.whenIdle()

  expect(turnEndReasons(agent)).toEqual(['completed'])
  const firstReq = JSON.stringify(adapter.requests[0] ?? '')
  // Hard rule summary (order 900), user-model guard (910), preference (920)
  // all surface in the one assembled request — proving the combination.
  expect(firstReq).toContain('tests-must-pass')            // hard rule
  expect(firstReq).toContain('改完代码后先跑测试再提交')      // user-model guard
  expect(firstReq).toContain('提交信息用中文')              // user-model preference
  await ctx.fiber.dispose()
}, 20_000)

it('the hard gate from the parsed config is active (edit without test → remediation fires)', async () => {
  const entries = loadCordisConfig(CORDIS_YML)
  const dsh = entries.find(e => e.name === 'dsh-policy')!
  const { agent, adapter, ctx } = await buildStack(
    [editCall(), textResponse('done without running the tests')],
    dsh.options as DshPolicyOptions,
  )

  userSay(agent, 'change the code')
  // The script is too short to satisfy the remediation loop; we only need to
  // prove the hard gate fired from the parsed config, so swallow the exhaust.
  await agent.whenIdle().catch(() => {})

  expect(adapter.requests.some(r => JSON.stringify(r).includes('tests_pass'))).toBe(true)
  await ctx.fiber.dispose()
}, 20_000)
