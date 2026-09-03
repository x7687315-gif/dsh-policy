import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUiServer, type UiServer } from '../../src/ui/server.ts'
import { CANDIDATES_FILE, TOMBSTONES_FILE } from '../../src/behavior/store.ts'
import type { CandidateBehavior } from '../../src/behavior/types.ts'
import type { PolicyDocument } from '../../src/policy/schema.ts'
import { guardsFromUserModel } from '../../src/usermodel/guards.ts'
import { readUserModel } from '../../src/usermodel/store.ts'

/**
 * Stage 17 — Web management UI. These tests drive the REAL server (bound to
 * 127.0.0.1:0) over HTTP and verify that every mutation flows through the
 * same barriers as the Review CLI: policy validation before write,
 * ConfirmRequest + audit on user-model mutations, tombstones on rejection.
 */

let server: UiServer
let base: string
let dir: string

const VALID_POLICY: PolicyDocument = {
  project: 'ui-test',
  policy: { hard: [{ id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' }] },
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-ui-'))
  mkdirSync(join(dir, 'behavior'), { recursive: true })
  mkdirSync(join(dir, 'evidence'), { recursive: true })

  const policyPath = join(dir, 'policy.json')
  writeFileSync(policyPath, JSON.stringify(VALID_POLICY))

  // The candidates queue is a PROJECTION rebuilt from the observation log at
  // runtime boot — so the fixture seeds observations (2 per signature, two
  // distinct sessions, fresh timestamps => promoted candidates).
  const now = Date.now()
  const observation = (id: string, signature: string, session: string, at: number) =>
    JSON.stringify({ kind: 'remediation_repeated', signature, sessionId: session, at, detail: 'remediation injected' })
  const observations = [
    observation('c1', 'remediation_repeated:r1', 's1', now - 10),
    observation('c1', 'remediation_repeated:r1', 's2', now - 5),
    observation('c2', 'tool_denied_repeated:rm', 's1', now - 10),
    observation('c2', 'tool_denied_repeated:rm', 's2', now - 5),
  ]
  writeFileSync(join(dir, 'behavior', 'observations.jsonl'), `${observations.join('\n')}\n`)

  // one evidence session with two events + a torn line
  const lines = [
    JSON.stringify({ sessionId: 'ui-session', event: { kind: 'code_change', at: 1, tool: 'edit_file', detail: 'x' } }),
    JSON.stringify({ sessionId: 'ui-session', event: { kind: 'tool_pass', at: 2, tool: 'run_tests', passed: true, detail: 'ALL PASSED' } }),
    '{"torn',
    '',
  ]
  writeFileSync(join(dir, 'evidence', 'ui-session.jsonl'), lines.join('\n'))

  server = await createUiServer({
    port: 0,
    policyPath,
    globalPolicyPath: join(dir, 'global-policy.json'),
    candidatesRoot: join(dir, 'behavior'),
    userModelPath: join(dir, 'user-model.json'),
    projectRegistryPath: join(dir, 'registry.json'),
    evidenceRoot: join(dir, 'evidence'),
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('overview & policy', () => {
  it('reports counts from the real stores', async () => {
    const { status, body } = await api('GET', '/api/overview')
    expect(status).toBe(200)
    expect(body.policy.projectRules).toBe(1)
    expect(body.candidatesPending).toBe(2)
    expect(body.evidenceSessions).toBe(1)
  })

  it('serves the frontend', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('dsh-policy 管理台')
  })

  it('rejects an invalid policy with the validator errors — nothing is written', async () => {
    const bad = {
      project: 'ui-test',
      policy: { hard: [{ id: 'bad-regex', trigger: 'code_change', require: { kind: 'tool_pass', tool: 'x', passPattern: '([unclosed' }, enforcement: 'hard' }] },
    }
    const { status, body } = await api('PUT', '/api/policy?scope=project', bad)
    expect(status).toBe(400)
    expect(body.ok).toBe(false)
    // the original file is untouched
    expect((JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8')) as PolicyDocument).policy.hard).toHaveLength(1)
  })

  it('persists a valid policy edit atomically', async () => {
    const updated: PolicyDocument = {
      project: 'ui-test',
      policy: {
        hard: [
          VALID_POLICY.policy.hard[0]!,
          { id: 'no-danger', trigger: 'always', denyTools: ['drop_database'], enforcement: 'hard' },
        ],
      },
    }
    const { status, body } = await api('PUT', '/api/policy?scope=project', updated)
    expect(status).toBe(200)
    expect(body.rules).toBe(2)
    const onDisk = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8')) as PolicyDocument
    expect(onDisk.policy.hard.map(rule => rule.id)).toEqual(['test-after-code-change', 'no-danger'])
  })
})

describe('candidate review flow (the §2.1 barrier over HTTP)', () => {
  it('confirm-with-edit creates a durable record and drains the queue', async () => {
    const { status, body } = await api('POST', '/api/review', {
      candidateId: 'candidate:remediation_repeated:r1',
      action: 'edit',
      message: 'Always run the test suite before saying done.',
    })
    expect(status).toBe(200)
    expect(body.result).toBe('record-created')

    const records = readUserModel(join(dir, 'user-model.json'))
    const record = records.find(r => r.provenance.candidateId === 'candidate:remediation_repeated:r1')
    expect(record?.value).toMatchObject({ message: 'Always run the test suite before saying done.' })
    expect(record?.provenance.confirmedBy).toBe('user')

    // the guard projection immediately exposes it
    const guards = guardsFromUserModel(records)
    expect(guards.some(guard => guard.message.includes('Always run the test suite'))).toBe(true)

    // the queue file no longer lists the handled candidate
    const pending = JSON.parse(readFileSync(join(dir, 'behavior', CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
    expect(pending.map(c => c.id)).toEqual(['candidate:tool_denied_repeated:rm'])

    // audit trail written
    expect(existsSync(join(dir, 'user-model.audit.jsonl'))).toBe(true)
  })

  it('reject tombstones the signature — the candidate never resurfaces', async () => {
    const { status, body } = await api('POST', '/api/review', {
      candidateId: 'candidate:tool_denied_repeated:rm',
      action: 'reject',
    })
    expect(status).toBe(200)
    expect(body.result).toBe('tombstoned')
    expect(JSON.parse(readFileSync(join(dir, 'behavior', TOMBSTONES_FILE), 'utf8'))).toContain('tool_denied_repeated:rm')
    const pending = JSON.parse(readFileSync(join(dir, 'behavior', CANDIDATES_FILE), 'utf8')) as CandidateBehavior[]
    expect(pending).toHaveLength(0)
  })

  it('unknown candidates are reported, not silently dropped', async () => {
    const { status, body } = await api('POST', '/api/review', { candidateId: 'candidate:ghost', action: 'confirm' })
    expect(status).toBe(200)
    expect(body.result).toBe('unknown-candidate')
  })
})

describe('user-model records over HTTP', () => {
  it('creates a preference, disables a record, deletes it — all audited', async () => {
    const created = await api('POST', '/api/records', {
      kind: 'preference',
      value: { text: 'Prefer async/await', appliesTo: { language: 'typescript' }, priority: 60 },
    })
    expect(created.status).toBe(200)
    const record = created.body.record
    expect(record.kind).toBe('preference')

    const disabled = await api('PATCH', `/api/records/${record.id}`, { enabled: false })
    expect(disabled.body.record.enabled).toBe(false)
    const records = readUserModel(join(dir, 'user-model.json'))
    const projection = records.filter(r => r.enabled && r.kind === 'preference')
    expect(projection).toHaveLength(0)

    const deleted = await api('DELETE', `/api/records/${record.id}`)
    expect(deleted.status).toBe(200)
    expect(readUserModel(join(dir, 'user-model.json')).some(r => r.id === record.id)).toBe(false)

    const audit = readFileSync(join(dir, 'user-model.audit.jsonl'), 'utf8').trim().split('\n')
    expect(audit.every(line => JSON.parse(line).via === 'review-ui')).toBe(true)
  })
})

describe('project lifecycle over HTTP', () => {
  it('pauses and resumes a project; invalid states are rejected', async () => {
    const paused = await api('POST', '/api/projects/ui-proj/state', { state: 'paused' })
    expect(paused.status).toBe(200)
    const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'))
    expect(registry.projects['ui-proj'].state).toBe('paused')

    const resumed = await api('POST', '/api/projects/ui-proj/state', { state: 'active' })
    expect(resumed.status).toBe(200)

    const bad = await api('POST', '/api/projects/ui-proj/state', { state: 'deleted' })
    expect(bad.status).toBe(400)
  })
})

describe('evidence (read-only over HTTP)', () => {
  it('lists sessions and reads events, tolerating torn lines', async () => {
    const list = await api('GET', '/api/evidence')
    expect(list.body.sessions).toHaveLength(1)

    const read = await api('GET', '/api/evidence/ui-session.jsonl')
    expect(read.status).toBe(200)
    expect(read.body.totalLines).toBe(3) // two events + one torn line
    expect(read.body.events).toHaveLength(3)
    expect(read.body.events[0].event.kind).toBe('code_change')
    expect(read.body.events[2]).toEqual({ torn: true }) // transparency: torn lines are surfaced
  })

  it('rejects path traversal in the file name', async () => {
    const res = await api('GET', '/api/evidence/..%2Fuser-model.json')
    expect([400, 404]).toContain(res.status)
  })
})
