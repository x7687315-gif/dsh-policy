import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceRecorder } from '../../src/evidence/recorder.ts'
import { evaluatePolicy } from '../../src/engine/constraint-engine.ts'
import { loadPolicyFile, PolicyLoadError, resolvePolicyPath } from '../../src/policy/loader.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'
import { validatePolicyDocument } from '../../src/policy/validator.ts'

const validPolicy: PolicyDocument = {
  project: 'my-api',
  policy: {
    hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }],
  },
}

function recorderWith(events: Parameters<EvidenceRecorder['record']>[0][]): EvidenceRecorder {
  const recorder = new EvidenceRecorder()
  for (const event of events) recorder.record(event)
  return recorder
}

describe('policy validator', () => {
  it('accepts the plan document shape', () => {
    const result = validatePolicyDocument(validPolicy)
    expect(result).toEqual({ ok: true, policy: validPolicy })
  })

  it('rejects unknown triggers, requirements, duplicate ids and non-hard enforcement', () => {
    const result = validatePolicyDocument({
      project: 'x',
      policy: {
        hard: [
          { id: 'a', trigger: 'deploy', require: 'tests_pass', enforcement: 'hard' },
          { id: 'b', trigger: 'code_change', require: 'manual_review', enforcement: 'soft' },
          { id: 'a', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(4)
  })

  it('rejects a non-object document', () => {
    expect(validatePolicyDocument('nope').ok).toBe(false)
    expect(validatePolicyDocument(null).ok).toBe(false)
  })
})

describe('policy loader', () => {
  it('loads and validates a policy file from the conventional location', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-policy-'))
    try {
      const path = join(dir, '.dsh-policy', 'policy.json')
      mkdirSync(join(dir, '.dsh-policy'), { recursive: true })
      writeFileSync(path, JSON.stringify(validPolicy))
      expect(loadPolicyFile(path)).toEqual(validPolicy)
      expect(resolvePolicyPath(dir)).toBe(join(dir, '.dsh-policy', 'policy.json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loudly on missing file, bad JSON, and schema violations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-policy-'))
    try {
      expect(() => loadPolicyFile(join(dir, 'missing.json'))).toThrow(PolicyLoadError)

      const badJson = join(dir, 'bad.json')
      writeFileSync(badJson, '{ not json')
      expect(() => loadPolicyFile(badJson)).toThrow(PolicyLoadError)

      const badSchema = join(dir, 'schema.json')
      writeFileSync(badSchema, JSON.stringify({ project: 'x', policy: { hard: [{ id: '', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] } }))
      expect(() => loadPolicyFile(badSchema)).toThrow(/id/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('evidence recorder', () => {
  it('finds the last code change and passing tests strictly after it', () => {
    const recorder = recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'test_run', at: 90, tool: 'run_tests', passed: true, detail: '' }, // stale pass
      { kind: 'code_change', at: 200, tool: 'edit_file', detail: '' },
    ])
    expect(recorder.lastCodeChangeAt()).toBe(200)
    expect(recorder.hasPassingTestSince(200)).toBe(false)

    recorder.record({ kind: 'test_run', at: 300, tool: 'run_tests', passed: true, detail: '' })
    expect(recorder.hasPassingTestSince(200)).toBe(true)
  })
})

describe('constraint engine (plan §Phase 2 required cases, engine level)', () => {
  it('Case A: code changed + passing test afterwards → PASS', () => {
    const evaluation = evaluatePolicy(validPolicy, recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'test_run', at: 200, tool: 'run_tests', passed: true, detail: '' },
    ]))
    expect(evaluation).toEqual({ status: 'PASS', violations: [] })
  })

  it('Case B: code changed + failing tests → BLOCK with rule id and remediation', () => {
    const evaluation = evaluatePolicy(validPolicy, recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'test_run', at: 200, tool: 'run_tests', passed: false, detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
    if (evaluation.status === 'BLOCK') {
      expect(evaluation.violations[0]?.ruleId).toBe('test-after-code-change')
      expect(evaluation.violations[0]?.remediation).toContain('tests must pass')
    }
  })

  it('Case C: code changed + no test run → BLOCK', () => {
    const evaluation = evaluatePolicy(validPolicy, recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
  })

  it('Case D: no code change → rule never arms → PASS', () => {
    const evaluation = evaluatePolicy(validPolicy, recorderWith([
      { kind: 'test_run', at: 200, tool: 'run_tests', passed: false, detail: '' },
    ]))
    expect(evaluation).toEqual({ status: 'PASS', violations: [] })
  })

  it('a stale passing test before the change does not satisfy the rule', () => {
    const evaluation = evaluatePolicy(validPolicy, recorderWith([
      { kind: 'test_run', at: 50, tool: 'run_tests', passed: true, detail: '' },
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
  })
})
