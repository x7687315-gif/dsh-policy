import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceRecorder } from '../../src/evidence/recorder.ts'
import { evaluatePolicy } from '../../src/engine/constraint-engine.ts'
import { loadPolicyFile, PolicyLoadError, resolvePolicyPath } from '../../src/policy/loader.ts'
import { resolvePolicies, type ScopedPolicy } from '../../src/policy/resolver.ts'
import type { PolicyDocument, ToolPassRule } from '../../src/policy/schema.ts'
import { validatePolicyDocument } from '../../src/policy/validator.ts'

const testsPassRule = {
  id: 'test-after-code-change',
  trigger: 'code_change',
  require: 'tests_pass',
  enforcement: 'hard',
} as const

const validPolicy: PolicyDocument = {
  project: 'my-api',
  policy: { hard: [testsPassRule] },
}

function resolveOne(document: PolicyDocument, scope: ScopedPolicy['scope'] = 'project') {
  return resolvePolicies([{ scope, document }])
}

function recorderWith(events: Parameters<EvidenceRecorder['record']>[0][]): EvidenceRecorder {
  const recorder = new EvidenceRecorder()
  for (const event of events) recorder.record(event)
  return recorder
}

describe('policy validator (v1)', () => {
  it('accepts the plan document shape, explicit scopes, evidence config, and object requirements', () => {
    const result = validatePolicyDocument({
      project: 'my-api',
      scope: 'project',
      evidence: {
        codeChangeTools: ['edit_file'],
        verificationTools: [{ tool: 'typecheck', passPattern: '\\bNO ISSUES\\b' }],
      },
      policy: {
        hard: [
          testsPassRule,
          { id: 'typed', trigger: 'code_change', require: { kind: 'tool_pass', tool: 'typecheck' }, enforcement: 'hard' },
          { id: 'no-danger', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' },
          { id: 'off', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard', enabled: false },
        ],
      },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects unknown built-in requirements, bad deny rules, and bad scopes', () => {
    const result = validatePolicyDocument({
      project: 'x',
      scope: 'universe',
      policy: {
        hard: [
          { id: 'a', trigger: 'code_change', require: 'manual_review', enforcement: 'hard' },
          { id: 'b', trigger: 'deploy', denyTools: ['rm'], enforcement: 'hard' },
          { id: 'c', trigger: 'always', denyTools: [], enforcement: 'hard' },
          { id: 'd', trigger: 'code_change', require: { kind: 'lint', tool: 'x' }, enforcement: 'hard' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('rejects duplicate ids and non-hard enforcement', () => {
    const result = validatePolicyDocument({
      project: 'x',
      policy: {
        hard: [
          testsPassRule,
          { ...testsPassRule },
          { ...testsPassRule, id: 'soft', enforcement: 'soft' },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })

  it('rejects non-object documents', () => {
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

describe('policy resolver — Constraint Monotonicity (plan §2.5)', () => {
  const globalDoc: PolicyDocument = {
    project: 'platform',
    scope: 'global',
    policy: { hard: [testsPassRule] },
  }
  const projectDoc: PolicyDocument = {
    project: 'my-api',
    scope: 'project',
    policy: {
      hard: [{ id: 'typecheck-required', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' }],
    },
  }

  it('a specific scope may ADD hard rules', () => {
    const resolution = resolvePolicies([
      { scope: 'global', document: globalDoc },
      { scope: 'project', document: projectDoc },
    ])
    expect(resolution.rules.map(rule => rule.id)).toEqual(['test-after-code-change', 'typecheck-required'])
    expect(resolution.conflicts).toEqual([])
  })

  it('a specific scope cannot weaken a stronger scope: omitting a global rule changes nothing', () => {
    const resolution = resolvePolicies([
      { scope: 'global', document: globalDoc },
      { scope: 'project', document: { project: 'my-api', scope: 'project', policy: { hard: [] } } },
    ])
    expect(resolution.rules.map(rule => rule.id)).toEqual(['test-after-code-change'])
  })

  it('a duplicate id across scopes keeps the stronger scope and reports the conflict', () => {
    const weaker: PolicyDocument = {
      project: 'my-api',
      scope: 'project',
      policy: { hard: [{ ...testsPassRule, require: 'typecheck_pass' }] },
    }
    const resolution = resolvePolicies([
      { scope: 'global', document: globalDoc },
      { scope: 'project', document: weaker },
    ])
    expect(resolution.rules).toHaveLength(1)
    expect((resolution.rules[0] as ToolPassRule).require).toBe('tests_pass') // global version kept
    expect(resolution.conflicts).toEqual(['test-after-code-change'])
    expect(resolution.monotonicityNotes[0]).toContain('never weakens')
  })

  it('deactivated rules are excluded from the resolution', () => {
    const resolution = resolveOne({
      project: 'x',
      policy: { hard: [{ ...testsPassRule, enabled: false }, { ...testsPassRule, id: 'on' }] },
    })
    expect(resolution.rules.map(rule => rule.id)).toEqual(['on'])
  })
})

describe('evidence recorder', () => {
  it('finds the last code change and passing tool runs strictly after it, per tool', () => {
    const recorder = recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'tool_pass', at: 90, tool: 'run_tests', passed: true, detail: '' }, // stale pass
      { kind: 'tool_pass', at: 150, tool: 'typecheck', passed: true, detail: '' }, // wrong tool
      { kind: 'code_change', at: 200, tool: 'edit_file', detail: '' },
    ])
    expect(recorder.lastCodeChangeAt()).toBe(200)
    expect(recorder.hasPassingToolRunSince(200, 'run_tests')).toBe(false)
    expect(recorder.hasPassingToolRunSince(200, 'typecheck')).toBe(false)

    recorder.record({ kind: 'tool_pass', at: 300, tool: 'typecheck', passed: true, detail: '' })
    expect(recorder.hasPassingToolRunSince(200, 'typecheck')).toBe(true)
    expect(recorder.hasPassingToolRunSince(200, 'run_tests')).toBe(false)
  })
})

describe('constraint engine (plan §Phase 2 cases + v1 multi-rule)', () => {
  it('Case A: code changed + passing test afterwards → PASS', () => {
    const evaluation = evaluatePolicy(resolveOne(validPolicy), recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'tool_pass', at: 200, tool: 'run_tests', passed: true, detail: '' },
    ]))
    expect(evaluation).toEqual({ status: 'PASS', violations: [] })
  })

  it('Case B: code changed + failing tests → BLOCK with rule id and remediation', () => {
    const evaluation = evaluatePolicy(resolveOne(validPolicy), recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'tool_pass', at: 200, tool: 'run_tests', passed: false, detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
    if (evaluation.status === 'BLOCK') {
      expect(evaluation.violations[0]?.ruleId).toBe('test-after-code-change')
      expect(evaluation.violations[0]?.remediation).toContain('tests must pass')
    }
  })

  it('Case C: code changed + no test run → BLOCK', () => {
    const evaluation = evaluatePolicy(resolveOne(validPolicy), recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
  })

  it('Case D: no code change → rule never arms → PASS', () => {
    const evaluation = evaluatePolicy(resolveOne(validPolicy), recorderWith([
      { kind: 'tool_pass', at: 200, tool: 'run_tests', passed: false, detail: '' },
    ]))
    expect(evaluation).toEqual({ status: 'PASS', violations: [] })
  })

  it('a stale passing run before the change does not satisfy the rule', () => {
    const evaluation = evaluatePolicy(resolveOne(validPolicy), recorderWith([
      { kind: 'tool_pass', at: 50, tool: 'run_tests', passed: true, detail: '' },
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
    ]))
    expect(evaluation.status).toBe('BLOCK')
  })

  it('multiple hard rules are evaluated independently', () => {
    const twoRules: PolicyDocument = {
      project: 'my-api',
      policy: {
        hard: [
          testsPassRule,
          { id: 'typecheck-required', trigger: 'code_change', require: 'typecheck_pass', enforcement: 'hard' },
        ],
      },
    }
    const evaluation = evaluatePolicy(resolveOne(twoRules), recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
      { kind: 'tool_pass', at: 200, tool: 'run_tests', passed: true, detail: '' }, // tests ok, typecheck missing
    ]))
    expect(evaluation.status).toBe('BLOCK')
    if (evaluation.status === 'BLOCK') {
      expect(evaluation.violations.map(violation => violation.ruleId)).toEqual(['typecheck-required'])
    }
  })

  it('deactivated rules are not enforced', () => {
    const off: PolicyDocument = {
      project: 'x',
      policy: { hard: [{ ...testsPassRule, enabled: false }] },
    }
    const evaluation = evaluatePolicy(resolveOne(off), recorderWith([
      { kind: 'code_change', at: 100, tool: 'edit_file', detail: '' },
    ]))
    expect(evaluation).toEqual({ status: 'PASS', violations: [] })
  })
})
