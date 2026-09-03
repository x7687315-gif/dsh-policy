import { describe, expect, it } from 'vitest'
import { parseCordisConfig } from '../../src/config/loader.ts'

describe('parseCordisConfig (minimal YAML subset, Stage 15 §8.1)', () => {
  it('parses a plugins list with nested options, scalars, bool, number', () => {
    const yaml = `
plugins:
  - name: '@deepseek-ai/dsh-llm-deepseek'
    options:
      apiKey: \${DEEPSEEK_API_KEY}
      model: deepseek-chat
      baseURL: https://api.deepseek.com
  - name: dsh-policy
    options:
      policyPath: tests/fixtures/combo-policy.json
      behavior:
        enabled: true
      context:
        tokenBudget: 800
      projectId: combo-demo
`
    const entries = parseCordisConfig(yaml)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.name).toBe('@deepseek-ai/dsh-llm-deepseek')
    expect(entries[0]!.options).toMatchObject({
      apiKey: '',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com',
    })
    expect(entries[1]!.name).toBe('dsh-policy')
    expect(entries[1]!.options).toMatchObject({
      policyPath: 'tests/fixtures/combo-policy.json',
      behavior: { enabled: true },
      context: { tokenBudget: 800 },
      projectId: 'combo-demo',
    })
  })

  it('interpolates ${ENV} from the environment', () => {
    process.env.DSH_TEST_KEY = 'sk-secret'
    try {
      const yaml = `
plugins:
  - name: x
    options:
      apiKey: \${DSH_TEST_KEY}
`
      const entries = parseCordisConfig(yaml)
      expect(entries[0]!.options.apiKey).toBe('sk-secret')
    } finally {
      delete process.env.DSH_TEST_KEY
    }
  })

  it('returns [] when there is no plugins key', () => {
    expect(parseCordisConfig('foo: bar\nbaz:\n  - 1\n')).toEqual([])
  })

  it('handles inline flow lists', () => {
    const yaml = `
plugins:
  - name: dsh-policy
    options:
      taskGoalIds: [g1, g2]
`
    const entries = parseCordisConfig(yaml)
    expect(entries[0]!.options.taskGoalIds).toEqual(['g1', 'g2'])
  })
})
