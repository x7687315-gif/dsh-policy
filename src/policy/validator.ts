import { DEFAULT_REQUIRE_TOOL, type PolicyDocument } from './schema.ts'

export type PolicyValidation =
  | { ok: true; policy: PolicyDocument }
  | { ok: false; errors: string[] }

const TRIGGERS = new Set(['code_change'])
const DENY_TRIGGERS = new Set(['always'])
const SCOPES = new Set(['global', 'project'])

/**
 * Structural validation for a policy document read from disk or received
 * inline. Deliberately strict: a malformed hard rule must never silently
 * become a no-op gate.
 */
export function validatePolicyDocument(input: unknown): PolicyValidation {
  const errors: string[] = []

  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['policy document must be a JSON object'] }
  }
  const doc = input as Record<string, unknown>

  if (typeof doc['project'] !== 'string' || doc['project'].length === 0) {
    errors.push('"project" must be a non-empty string')
  }
  if (doc['scope'] !== undefined && (typeof doc['scope'] !== 'string' || !SCOPES.has(doc['scope']))) {
    errors.push('"scope" must be one of: global, project')
  }
  validateEvidence(doc['evidence'], errors)

  const policy = doc['policy']
  if (typeof policy !== 'object' || policy === null) {
    errors.push('"policy" must be an object')
    return { ok: false, errors }
  }
  const hard = (policy as Record<string, unknown>)['hard']
  if (!Array.isArray(hard)) {
    errors.push('"policy.hard" must be an array')
    return { ok: false, errors }
  }

  const seen = new Set<string>()
  hard.forEach((raw, index) => {
    const where = `policy.hard[${index}]`
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${where} must be an object`)
      return
    }
    const rule = raw as Record<string, unknown>

    if (typeof rule['id'] !== 'string' || rule['id'].length === 0) {
      errors.push(`${where}.id must be a non-empty string`)
    } else if (seen.has(rule['id'])) {
      errors.push(`${where}.id "${rule['id']}" is duplicated`)
    } else {
      seen.add(rule['id'])
    }
    if (rule['enforcement'] !== 'hard') {
      errors.push(`${where}.enforcement must be "hard" (layer-1 rules are hard by definition)`)
    }
    if (rule['enabled'] !== undefined && typeof rule['enabled'] !== 'boolean') {
      errors.push(`${where}.enabled must be a boolean when present`)
    }
    if (rule['remediation'] !== undefined && typeof rule['remediation'] !== 'string') {
      errors.push(`${where}.remediation must be a string when present`)
    }

    if (Array.isArray(rule['denyTools'])) {
      // MUST NOT rule: always-on, enforced at tools/pre-execute. The trigger
      // is REQUIRED — a deny rule that slips through unenforced because its
      // shape was ambiguous is exactly the silent no-op this validator exists
      // to prevent.
      if (typeof rule['trigger'] !== 'string' || !DENY_TRIGGERS.has(rule['trigger'])) {
        errors.push(`${where}.trigger must be "always" for denyTools rules`)
      }
      const tools = rule['denyTools'] as unknown[]
      if (tools.length === 0 || tools.some((tool: unknown) => typeof tool !== 'string' || tool.length === 0)) {
        errors.push(`${where}.denyTools must be a non-empty array of non-empty strings`)
      }
      return
    }

    // Tool-pass rule: armed by a trigger, verified from evidence.
    if (typeof rule['trigger'] !== 'string' || !TRIGGERS.has(rule['trigger'])) {
      errors.push(`${where}.trigger must be one of: ${[...TRIGGERS].join(', ')}`)
    }
    const require = rule['require']
    if (typeof require === 'string') {
      if (!(require in DEFAULT_REQUIRE_TOOL)) {
        errors.push(`${where}.require must be one of: ${Object.keys(DEFAULT_REQUIRE_TOOL).join(', ')} or a { kind: "tool_pass", tool } object`)
      }
    } else if (typeof require === 'object' && require !== null) {
      const req = require as Record<string, unknown>
      if (req['kind'] !== 'tool_pass') {
        errors.push(`${where}.require.kind must be "tool_pass"`)
      }
      if (typeof req['tool'] !== 'string' || req['tool'].length === 0) {
        errors.push(`${where}.require.tool must be a non-empty string`)
      }
      if (req['passPattern'] !== undefined) {
        if (typeof req['passPattern'] !== 'string') {
          errors.push(`${where}.require.passPattern must be a string when present`)
        } else {
          validateRegex(req['passPattern'], `${where}.require`, errors)
        }
      }
    } else {
      errors.push(`${where}.require must be a built-in name or a { kind: "tool_pass", tool } object`)
    }
  })

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, policy: input as PolicyDocument }
}

/**
 * A pass pattern is fed straight into `new RegExp(pattern)` at enforcement
 * time (plugin post-execute evidence match). A malformed pattern must be
 * rejected HERE — at load — so it can never surface as a runtime crash or a
 * silent false BLOCK. Fail fast, loudly, at validation.
 */
function validateRegex(pattern: string, where: string, errors: string[]): void {
  try {
    new RegExp(pattern)
  } catch {
    errors.push(`${where}.passPattern "${pattern}" is not a valid regular expression`)
  }
}

function validateEvidence(evidence: unknown, errors: string[]): void {
  if (evidence === undefined) return
  if (typeof evidence !== 'object' || evidence === null) {
    errors.push('"evidence" must be an object when present')
    return
  }
  const cfg = evidence as Record<string, unknown>
  if (cfg['codeChangeTools'] !== undefined) {
    const tools = cfg['codeChangeTools']
    if (!Array.isArray(tools) || tools.some((tool: unknown) => typeof tool !== 'string' || tool.length === 0)) {
      errors.push('"evidence.codeChangeTools" must be an array of non-empty strings')
    }
  }
  if (cfg['verificationTools'] !== undefined) {
    const entries = cfg['verificationTools']
    if (!Array.isArray(entries)) {
      errors.push('"evidence.verificationTools" must be an array')
    } else {
      entries.forEach((entry: unknown, index: number) => {
        if (typeof entry !== 'object' || entry === null || typeof (entry as Record<string, unknown>)['tool'] !== 'string') {
          errors.push(`evidence.verificationTools[${index}] must be { tool: string, passPattern?: string }`)
          return
        }
        const passPattern = (entry as Record<string, unknown>)['passPattern']
        if (passPattern !== undefined) {
          if (typeof passPattern !== 'string') {
            errors.push(`evidence.verificationTools[${index}].passPattern must be a string`)
          } else {
            validateRegex(passPattern, `evidence.verificationTools[${index}]`, errors)
          }
        }
      })
    }
  }
}
