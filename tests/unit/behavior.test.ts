import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confidenceOf } from '../../src/behavior/confidence.ts'
import { BehaviorObserver } from '../../src/behavior/observer.ts'
import { BehaviorStore, CANDIDATES_FILE, OBSERVATIONS_FILE } from '../../src/behavior/store.ts'
import { correctionSignature, ruleSignature, signatureSubject, toolDenySignature } from '../../src/behavior/signature.ts'
import { createBehaviorRuntime, detectCorrection } from '../../src/behavior/wire.ts'
import type { ObservationRecord } from '../../src/behavior/types.ts'

const FRESH = { kind: 'remediation_repeated', lastSeenAt: 1_000, now: 1_000 } as const

function observation(overrides: Partial<ObservationRecord> & { signature: string; sessionId: string }): ObservationRecord {
  return { kind: 'remediation_repeated', at: 1_000, detail: 'x', ...overrides }
}

describe('signatures', () => {
  it('normalizes corrections: case, numbers, paths, punctuation collapse away', () => {
    expect(correctionSignature('The path /a/b/c is WRONG again!'))
      .toBe(correctionSignature('the path /x/y is wrong again'))
    expect(correctionSignature('又改错了 /a/b/c 第3次')).toBe(correctionSignature('又改错了 /x/y 第9次'))
    expect(correctionSignature('tests are failing')).not.toBe(correctionSignature('tests are passing'))
  })

  it('keeps enforcement signatures exact (rule ids and tools are already canonical)', () => {
    expect(ruleSignature('remediation_repeated', 'r1')).toBe('remediation_repeated:r1')
    expect(toolDenySignature('rm')).toBe('tool_denied_repeated:rm')
    expect(signatureSubject('remediation_repeated:r1')).toBe('r1')
  })
})

describe('confidence formula (roadmap §3.4 reference points)', () => {
  it('a single fresh runtime-proof occurrence never promotes', () => {
    expect(confidenceOf({ ...FRESH, kind: 'remediation_repeated', occurrences: 1, distinctSessions: 1 })).toBeLessThan(0.6)
  })

  it('two occurrences across two fresh sessions of runtime proof promote', () => {
    expect(confidenceOf({ ...FRESH, kind: 'remediation_repeated', occurrences: 2, distinctSessions: 2 })).toBeGreaterThanOrEqual(0.6)
  })

  it('recency decay kills stale patterns', () => {
    const stale = confidenceOf({ kind: 'remediation_repeated', occurrences: 2, distinctSessions: 2, lastSeenAt: 0, now: 60 * 86_400_000 })
    expect(stale).toBeLessThan(0.6)
  })

  it('heuristic signals need more evidence than runtime proof', () => {
    const correction = confidenceOf({ ...FRESH, kind: 'user_correction', occurrences: 2, distinctSessions: 2 })
    const enforcement = confidenceOf({ ...FRESH, kind: 'remediation_repeated', occurrences: 2, distinctSessions: 2 })
    expect(correction).toBeLessThan(enforcement)
  })
})

describe('BehaviorObserver', () => {
  it('aggregates occurrences and distinct sessions, caps evidence, dedupes by signature', () => {
    const observer = new BehaviorObserver({ now: () => 1_000 })
    observer.note(observation({ signature: 'remediation_repeated:r1', sessionId: 'a' }))
    observer.note(observation({ signature: 'remediation_repeated:r1', sessionId: 'b', at: 2_000 }))
    observer.note(observation({ signature: 'remediation_repeated:r1', sessionId: 'b', at: 3_000, detail: 'y' }))

    const candidate = observer.recompute('remediation_repeated:r1')
    expect(candidate).toMatchObject({
      id: 'candidate:remediation_repeated:r1',
      occurrences: 3,
      distinctSessions: 2,
      firstSeen: 1_000,
      lastSeen: 3_000,
      status: 'candidate',
    })
    expect(candidate?.evidence).toHaveLength(3)
  })

  it('rejects below-threshold aggregates and tombstoned signatures', () => {
    const observer = new BehaviorObserver({ now: () => 1_000 })
    observer.note(observation({ signature: 'remediation_repeated:r2', sessionId: 'a' }))
    expect(observer.recompute('remediation_repeated:r2')).toBeUndefined() // 1 occurrence

    observer.note(observation({ signature: 'remediation_repeated:r3', sessionId: 'a' }))
    observer.note(observation({ signature: 'remediation_repeated:r3', sessionId: 'b', at: 2_000 }))
    expect(observer.recompute('remediation_repeated:r3')).toBeDefined()

    observer.reject('remediation_repeated:r3')
    expect(observer.isRejected('remediation_repeated:r3'))
    expect(observer.recompute('remediation_repeated:r3')).toBeUndefined() // tombstone wins
    observer.note(observation({ signature: 'remediation_repeated:r3', sessionId: 'c', at: 4_000 }))
    expect(observer.recompute('remediation_repeated:r3')).toBeUndefined() // never reappears
  })

  it('hydrate restores observations and tombstones (restart survival)', () => {
    const observer = new BehaviorObserver({ now: () => 1_000 })
    observer.hydrate(
      [
        observation({ signature: 'remediation_repeated:r4', sessionId: 'a' }),
        observation({ signature: 'remediation_repeated:r4', sessionId: 'b', at: 2_000 }),
      ],
      ['remediation_repeated:r5'],
    )
    expect(observer.recompute('remediation_repeated:r4')).toBeDefined()
    expect(observer.recompute('remediation_repeated:r5')).toBeUndefined()
    expect(observer.candidates().map(candidate => candidate.id)).toEqual(['candidate:remediation_repeated:r4'])
  })
})

describe('BehaviorStore + runtime wiring', () => {
  it('persists observations, candidates and tombstones; hydrates on a fresh runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-behavior-'))
    try {
      const first = createBehaviorRuntime({ enabled: true, root, now: () => 5_000 })
      first?.note(observation({ signature: 'remediation_repeated:r6', sessionId: 'a' }))
      first?.note(observation({ signature: 'remediation_repeated:r6', sessionId: 'b', at: 2_000 }))
      expect(existsSync(join(root, OBSERVATIONS_FILE))).toBe(true)
      expect(existsSync(join(root, CANDIDATES_FILE))).toBe(true)

      // Fresh runtime over the same directory (process restart): the
      // projection is rebuilt from the observation log.
      const second = createBehaviorRuntime({ enabled: true, root, now: () => 5_000 })
      const candidates = second?.candidates() ?? []
      expect(candidates.map(candidate => candidate.signature)).toEqual(['remediation_repeated:r6'])
      expect(JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8'))).toHaveLength(1)

      // Rejection writes a tombstone and removes the candidate from the queue.
      second?.reject('remediation_repeated:r6')
      const after = JSON.parse(readFileSync(join(root, CANDIDATES_FILE), 'utf8'))
      expect(after).toHaveLength(0)
      expect(new BehaviorStore(root).loadTombstones()).toEqual(['remediation_repeated:r6'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is inert when disabled or unpersisted', () => {
    expect(createBehaviorRuntime({ enabled: false, root: '/tmp/x' })).toBeUndefined()
    const memory = createBehaviorRuntime({ enabled: true, now: () => 5_000 })
    memory?.note(observation({ signature: 'remediation_repeated:r7', sessionId: 'a' }))
    memory?.note(observation({ signature: 'remediation_repeated:r7', sessionId: 'b', at: 2_000 }))
    expect(memory?.candidates()).toHaveLength(1) // works in memory, writes nothing
  })

  it('REGRESSION: handled candidates never re-surface, even after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-behavior-handled-'))
    try {
      const runtime = createBehaviorRuntime({ enabled: true, root, now: () => 5_000 })
      runtime?.note(observation({ signature: 'remediation_repeated:r8', sessionId: 'a' }))
      runtime?.note(observation({ signature: 'remediation_repeated:r8', sessionId: 'b', at: 2_000 }))
      const [pending] = runtime?.candidates() ?? []
      expect(pending).toBeDefined()

      // The review flow confirmed this candidate → mark handled.
      runtime?.markHandled(pending!.id)
      expect(runtime?.candidates()).toHaveLength(0)

      // A fresh runtime (restart) must ALSO hide it: the observation log
      // still holds the records, but handled.json wins.
      const revived = createBehaviorRuntime({ enabled: true, root, now: () => 5_000 })
      expect(revived?.candidates()).toHaveLength(0)
      // New occurrences of the SAME candidate id stay suppressed...
      revived?.note(observation({ signature: 'remediation_repeated:r8', sessionId: 'c', at: 6_000 }))
      expect(revived?.candidates()).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('correction heuristic', () => {
  it('detects short corrective messages and ignores long or neutral ones', () => {
    expect(detectCorrection('还是不对，你再看看')).toBeDefined()
    expect(detectCorrection('I said run the tests first')).toBeDefined()
    expect(detectCorrection('please implement the feature as discussed in the design doc, including the API changes, migrations, and the full test suite'.repeat(2))).toBeUndefined()
    expect(detectCorrection('looks good, thanks')).toBeUndefined()
  })

  it('supports custom phrase lists', () => {
    expect(detectCorrection('the diff is too big', { correctionPhrases: ['too big'] })).toBeDefined()
  })

  it('writing tombstones.json is honored by a fresh runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-behavior-tomb-'))
    try {
      writeFileSync(join(root, 'tombstones.json'), JSON.stringify(['user_correction:whatever']))
      const runtime = createBehaviorRuntime({ enabled: true, root })
      runtime?.note({ kind: 'user_correction', signature: 'user_correction:whatever', sessionId: 'a', at: 1_000, detail: '' })
      runtime?.note({ kind: 'user_correction', signature: 'user_correction:whatever', sessionId: 'b', at: 2_000, detail: '' })
      expect(runtime?.candidates()).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
