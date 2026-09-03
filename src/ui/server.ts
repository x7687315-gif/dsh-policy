/**
 * dsh-policy Web management UI (Stage 17).
 *
 * A dependency-free local HTTP server that exposes the SAME stores the
 * Review CLI uses — hard policy, behavior candidates, the user model, the
 * project lifecycle registry, and evidence — through a small REST API and a
 * single-page frontend.
 *
 * Write-path discipline (plan §2.1): this server is the SECOND legitimate
 * writer (the first is the Review CLI). Every mutation originates from an
 * explicit user action in the browser and flows through the exact same
 * barriers as the CLI:
 *   - user-model mutations   → UserModelStore + ConfirmRequest{via:'review-ui'} + audit
 *   - candidate confirm/edit → applyReview → durable record; reject → tombstone
 *   - policy edits           → validatePolicyDocument BEFORE any write (bad rules never hit disk)
 * The plugin runtime stays read-only. It re-reads policy/user-model at its
 * next activation, so UI changes take effect on reload/new sessions.
 *
 * Security posture: binds 127.0.0.1 ONLY — the local user is the authority,
 * exactly like the CLI. No remote exposure.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdirSync, renameSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePolicyDocument, type PolicyValidation } from '../policy/validator.ts'
import type { PolicyDocument } from '../policy/schema.ts'
import { resolvePolicyPath } from '../policy/loader.ts'
import { globalPolicyPath } from '../policy/loader.ts'
import { BehaviorStore } from '../behavior/store.ts'
import { createBehaviorRuntime } from '../behavior/wire.ts'
import { applyReview } from '../review/review.ts'
import { UserModelStore, auditPathFor } from '../usermodel/store.ts'
import type { ConfirmRequest, UserModelRecord, UserModelValue } from '../usermodel/schema.ts'
import { guardsFromUserModel } from '../usermodel/guards.ts'
import { preferencesFromUserModel } from '../usermodel/preferences.ts'
import { loadRegistry, saveRegistry, setProjectState, projectRegistryPath, isActive, type ProjectState } from '../project/registry.ts'

export interface UiServerOptions {
  port?: number
  host?: string
  /** Project policy file (read + validated write). */
  policyPath?: string
  /** Global policy file (read + validated write). */
  globalPolicyPath?: string
  /** Behavior root (candidates/tombstones/observations). */
  candidatesRoot?: string
  /** Durable user model file. */
  userModelPath?: string
  /** Project lifecycle registry file. */
  projectRegistryPath?: string
  /** Evidence root (read-only listing). */
  evidenceRoot?: string
}

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static')
const BODY_LIMIT = 1_000_000

interface JsonBody { [key: string]: unknown }

function readBody(req: IncomingMessage): Promise<JsonBody> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        rejectBody(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim().length === 0) return resolveBody({})
      try {
        resolveBody(JSON.parse(raw) as JsonBody)
      } catch {
        rejectBody(new Error('invalid JSON body'))
      }
    })
    req.on('error', rejectBody)
  })
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendStatic(res: ServerResponse, file: string): void {
  const path = join(STATIC_DIR, file)
  if (!existsSync(path)) {
    res.writeHead(404).end('not found')
    return
  }
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
  const ext = file.slice(file.lastIndexOf('.'))
  res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' })
  res.end(readFileSync(path))
}

/** Atomic JSON write (tmp + rename) — same discipline as the stores. */
function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

function loadPolicyOrNull(path: string): PolicyDocument | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as PolicyDocument : null
}

export interface UiServer {
  port: number
  close(): Promise<void>
}

/**
 * Create (and start listening) the management UI server.
 * Returns the resolved port so tests can bind port 0.
 */
export async function createUiServer(options: UiServerOptions = {}): Promise<UiServer> {
  const policyPath = resolve(options.policyPath ?? resolvePolicyPath())
  const globalPath = resolve(options.globalPolicyPath ?? globalPolicyPath())
  const candidatesRoot = options.candidatesRoot
  const userModelPath = options.userModelPath
  const registryPath = resolve(options.projectRegistryPath ?? projectRegistryPath())
  const evidenceRoot = options.evidenceRoot

  const behavior = candidatesRoot !== undefined
    ? createBehaviorRuntime({ enabled: true, root: candidatesRoot })
    : undefined
  const behaviorStore = candidatesRoot !== undefined ? new BehaviorStore(candidatesRoot) : undefined
  const userModel = userModelPath !== undefined ? new UserModelStore(userModelPath) : undefined

  // --- API handlers ---------------------------------------------------------

  function overview(): JsonBody {
    const project = loadPolicyOrNull(policyPath)
    const global = loadPolicyOrNull(globalPath)
    const records: UserModelRecord[] = userModel !== undefined ? userModel.records() : []
    const registry = loadRegistry(registryPath)
    const evidenceSessions = evidenceRoot !== undefined && existsSync(evidenceRoot)
      ? readdirSync(evidenceRoot).filter(f => f.endsWith('.jsonl'))
      : []
    return {
      policy: {
        projectRules: project?.policy.hard.length ?? 0,
        globalRules: global?.policy.hard.length ?? 0,
      },
      candidatesPending: behaviorStore?.loadCandidates().length ?? 0,
      guards: records.filter(r => r.kind === 'behavior_pattern' && r.enabled).length,
      preferences: records.filter(r => r.kind === 'preference' && r.enabled).length,
      projects: Object.keys(registry.projects).length,
      evidenceSessions: evidenceSessions.length,
    }
  }

  function getPolicy(): JsonBody {
    return {
      project: loadPolicyOrNull(policyPath),
      global: loadPolicyOrNull(globalPath),
      paths: { project: policyPath, global: globalPath },
    }
  }

  function putPolicy(scope: string, body: JsonBody): { status: number; body: JsonBody } {
    const validation: PolicyValidation = validatePolicyDocument(body)
    if (!validation.ok) return { status: 400, body: { ok: false, errors: validation.errors } }
    const target = scope === 'global' ? globalPath : policyPath
    writeJsonAtomic(target, body)
    return { status: 200, body: { ok: true, scope, path: target, rules: validation.policy.policy.hard.length } }
  }

  function listRecords(): JsonBody {
    const records: UserModelRecord[] = userModel !== undefined ? userModel.records() : []
    return {
      records,
      projection: {
        guards: guardsFromUserModel(records),
        preferences: preferencesFromUserModel(records),
      },
      auditFile: userModelPath !== undefined ? auditPathFor(userModelPath) : undefined,
    }
  }

  function reviewCandidate(body: JsonBody): { status: number; body: JsonBody } {
    if (behaviorStore === undefined || behavior === undefined || userModel === undefined) {
      return { status: 400, body: { ok: false, errors: ['candidates root / user model not configured'] } }
    }
    const candidateId = String(body['candidateId'] ?? '')
    const action = String(body['action'] ?? '')
    const message = body['message'] === undefined ? undefined : String(body['message'])
    const candidates = behaviorStore.loadCandidates()
    const outcomes = applyReview(
      candidates,
      userModel,
      [{ candidateId, action: action as 'confirm' | 'edit' | 'reject' | 'skip', message }],
      { via: 'review-ui', note: 'web review' } satisfies ConfirmRequest,
      { onReject: signature => behavior.reject(signature) },
    )
    const outcome = outcomes[0]!
    if (outcome.result === 'record-created') behavior.markHandled(outcome.candidateId)
    return { status: 200, body: { ok: true, ...outcome } }
  }

  function createRecord(body: JsonBody): { status: number; body: JsonBody } {
    if (userModel === undefined) return { status: 400, body: { ok: false, errors: ['user model not configured'] } }
    const kind = String(body['kind'] ?? '')
    if (kind !== 'behavior_pattern' && kind !== 'preference') {
      return { status: 400, body: { ok: false, errors: ['kind must be behavior_pattern or preference'] } }
    }
    const value = body['value'] as UserModelValue | undefined
    if (typeof value !== 'object' || value === null) {
      return { status: 400, body: { ok: false, errors: ['value is required'] } }
    }
    const record = userModel.create(
      { kind, value, candidateId: body['candidateId'] === undefined ? undefined : String(body['candidateId']) },
      { via: 'review-ui', note: 'created via web UI' },
    )
    return { status: 200, body: { ok: true, record } }
  }

  function patchRecord(id: string, body: JsonBody): { status: number; body: JsonBody } {
    if (userModel === undefined) return { status: 400, body: { ok: false, errors: ['user model not configured'] } }
    const request: ConfirmRequest = { via: 'review-ui', note: 'edited via web UI' }
    const patch: { value?: UserModelValue; enabled?: boolean } = {}
    if (body['value'] !== undefined) patch.value = body['value'] as UserModelValue
    if (body['enabled'] !== undefined) patch.enabled = Boolean(body['enabled'])
    if (patch.enabled === false) {
      const record = userModel.disable(id, request)
      return { status: 200, body: { ok: true, record } }
    }
    const record = userModel.update(id, patch, request)
    return { status: 200, body: { ok: true, record } }
  }

  function deleteRecord(id: string): { status: number; body: JsonBody } {
    if (userModel === undefined) return { status: 400, body: { ok: false, errors: ['user model not configured'] } }
    userModel.delete(id, { via: 'review-ui', note: 'deleted via web UI' })
    return { status: 200, body: { ok: true } }
  }

  function listProjects(): JsonBody {
    const registry = loadRegistry(registryPath)
    return { registry, registryPath, note: 'projects not listed here are treated as active' }
  }

  function setProjectStateEndpoint(id: string, body: JsonBody): { status: number; body: JsonBody } {
    const state = String(body['state'] ?? '')
    const valid: ProjectState[] = ['active', 'paused', 'completed', 'archived']
    if (!valid.includes(state as ProjectState)) {
      return { status: 400, body: { ok: false, errors: [`state must be one of ${valid.join(', ')} (use the CLI to archive — it also moves directories)`] } }
    }
    const next = setProjectState(loadRegistry(registryPath), id, state as ProjectState)
    saveRegistry(next, registryPath)
    return { status: 200, body: { ok: true, project: id, state } }
  }

  function listEvidence(): JsonBody {
    if (evidenceRoot === undefined || !existsSync(evidenceRoot)) return { sessions: [] }
    const sessions = readdirSync(evidenceRoot)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = join(evidenceRoot, f)
        return { file: f, bytes: statSync(full).size, modifiedAt: statSync(full).mtimeMs }
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
    return { sessions }
  }

  function readEvidenceFile(file: string): { status: number; body: JsonBody } {
    if (evidenceRoot === undefined || !/^[\w.-]+\.jsonl$/.test(file)) {
      return { status: 400, body: { ok: false, errors: ['invalid file name'] } }
    }
    const full = join(evidenceRoot, file)
    if (!existsSync(full)) return { status: 404, body: { ok: false, errors: ['not found'] } }
    const lines = readFileSync(full, 'utf8').split('\n').filter(l => l.trim().length > 0)
    const events = lines.slice(-50).map(line => {
      try { return JSON.parse(line) } catch { return { torn: true } }
    })
    return { status: 200, body: { file, totalLines: lines.length, events } }
  }

  // --- Router ---------------------------------------------------------------

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean) // e.g. ['api','records','um-123']
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') return sendStatic(res, 'index.html')
      if (url.pathname === '/app.js') return sendStatic(res, 'app.js')
      if (url.pathname === '/styles.css') return sendStatic(res, 'styles.css')

      if (parts[0] !== 'api') return sendJson(res, 404, { ok: false, errors: ['not found'] })

      if (req.method === 'GET' && url.pathname === '/api/overview') return sendJson(res, 200, overview())
      if (req.method === 'GET' && url.pathname === '/api/policy') return sendJson(res, 200, getPolicy())
      if (req.method === 'PUT' && url.pathname === '/api/policy') {
        const body = await readBody(req)
        const scope = String(url.searchParams.get('scope') ?? 'project')
        const out = putPolicy(scope, body)
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'GET' && url.pathname === '/api/candidates') {
        return sendJson(res, 200, { candidates: behaviorStore?.loadCandidates() ?? [] })
      }
      if (req.method === 'POST' && url.pathname === '/api/review') {
        const body = await readBody(req)
        const out = reviewCandidate(body)
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'GET' && url.pathname === '/api/records') return sendJson(res, 200, listRecords())
      if (req.method === 'POST' && url.pathname === '/api/records') {
        const body = await readBody(req)
        const out = createRecord(body)
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'PATCH' && parts[1] === 'records' && parts[2] !== undefined) {
        const body = await readBody(req)
        const out = patchRecord(parts[2], body)
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'DELETE' && parts[1] === 'records' && parts[2] !== undefined) {
        const out = deleteRecord(parts[2])
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'GET' && url.pathname === '/api/projects') return sendJson(res, 200, listProjects())
      if (req.method === 'POST' && parts[1] === 'projects' && parts[2] !== undefined && parts[3] === 'state') {
        const body = await readBody(req)
        const out = setProjectStateEndpoint(parts[2], body)
        return sendJson(res, out.status, out.body)
      }
      if (req.method === 'GET' && url.pathname === '/api/evidence') return sendJson(res, 200, listEvidence())
      if (req.method === 'GET' && parts[1] === 'evidence' && parts[2] !== undefined) {
        const out = readEvidenceFile(parts[2])
        return sendJson(res, out.status, out.body)
      }
      return sendJson(res, 404, { ok: false, errors: ['not found'] })
    } catch (error) {
      return sendJson(res, 500, { ok: false, errors: [error instanceof Error ? error.message : String(error)] })
    }
  }

  const server: Server = createServer((req, res) => {
    void route(req, res)
  })

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.once('error', rejectPort)
    server.listen(options.port ?? 5178, options.host ?? '127.0.0.1', () => {
      const address = server.address()
      resolvePort(typeof address === 'object' && address !== null ? address.port : options.port ?? 5178)
    })
  })

  return {
    port,
    close: async () => { await new Promise<void>(resolveClose => server.close(() => resolveClose())) },
  }
}

// --- CLI entry ----------------------------------------------------------------

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const candidatesRoot = arg('candidates')
  const userModelPath = arg('model')
  const evidenceRoot = arg('evidence')
  const server = await createUiServer({
    port: arg('port') !== undefined ? Number(arg('port')) : 5178,
    policyPath: arg('policy'),
    globalPolicyPath: arg('global'),
    candidatesRoot,
    userModelPath,
    projectRegistryPath: arg('registry'),
    evidenceRoot,
  })
  console.log('🧋 dsh-policy management UI')
  console.log(`   http://127.0.0.1:${server.port}`)
  console.log(`   policy: ${arg('policy') ?? resolvePolicyPath()}`)
  if (candidatesRoot !== undefined) console.log(`   candidates: ${candidatesRoot}`)
  if (userModelPath !== undefined) console.log(`   user model: ${userModelPath}`)
  console.log('   (localhost only — close with Ctrl+C)')
}
