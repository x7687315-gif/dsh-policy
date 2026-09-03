import { describe, expect, it } from 'vitest'
import { goalContextText, resolveContext, type ResolveContextInput } from '../../src/context/resolver.ts'
import type { Resolution } from '../../src/policy/resolver.ts'
import type { GoalNode } from '../../src/goal/types.ts'

const EMPTY_RESOLUTION: Resolution = { rules: [], conflicts: [], monotonicityNotes: [] }

const GOALS: GoalNode[] = [
  { id: 'g1', parentId: null, title: '发布 v1.0', linkedTaskIds: ['t-impl'] },
  { id: 'g2', parentId: 'g1', title: '补集成测试', linkedTaskIds: ['t-tests'] },
]

function input(over: Partial<ResolveContextInput> = {}): ResolveContextInput {
  return {
    taskProfile: { userMessage: 'implement the thing', recentFiles: [], recentTools: [] },
    resolution: EMPTY_RESOLUTION,
    guards: [],
    preferences: [],
    ...over,
  }
}

describe('goal model (roadmap §7.3)', () => {
  it('injects nothing when no goal is linked', () => {
    expect(goalContextText(GOALS, undefined)).toBe('')
    expect(goalContextText(GOALS, [])).toBe('')
    expect(goalContextText(undefined, ['g1'])).toBe('')
    expect(goalContextText(GOALS, ['g-missing'])).toBe('')
  })

  it('injects exactly one line for a linked goal', () => {
    const line = goalContextText(GOALS, ['g1'])
    expect(line).toContain('发布 v1.0')
    expect(line.startsWith('[dsh-policy] Linked goal')).toBe(true)
    // one line, no planning / decomposition text
    expect(line.split('\n')).toHaveLength(1)
  })

  it('joins multiple linked goals into a single line (no decomposition)', () => {
    const line = goalContextText(GOALS, ['g1', 'g2'])
    expect(line).toContain('发布 v1.0')
    expect(line).toContain('补集成测试')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('resolver surfaces the goal as a single 925 section only when linked', () => {
    const none = resolveContext(input())
    expect(none.sections.find(s => s.name === 'dsh-policy/goal')).toBeUndefined()

    const linked = resolveContext(input({ goals: GOALS, linkedGoalIds: ['g2'] }))
    const goal = linked.sections.find(s => s.name === 'dsh-policy/goal')
    expect(goal).toBeDefined()
    expect(goal!.order).toBe(925)
    expect(goal!.text).toContain('补集成测试')
  })

  it('goal context is independent of hard/guard/preference layers', () => {
    const linked = resolveContext(input({ goals: GOALS, linkedGoalIds: ['g1'] }))
    const orders = linked.sections.map(s => s.order)
    expect(orders).toContain(925)
    expect(orders.filter(o => o === 925)).toHaveLength(1)
  })
})
