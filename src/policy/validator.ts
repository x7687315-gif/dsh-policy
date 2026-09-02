import type { PolicyDocument } from './schema.ts'

export type PolicyValidation =
  | { ok: true; policy: PolicyDocument }
  | { ok: false; errors: string[] }

const TRIGGERS = new Set(['code_change'])
const REQUIREMENTS = new Set(['tests_pass'])

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

    if (typeof rule['trigger'] !== 'string' || !TRIGGERS.has(rule['trigger'])) {
      errors.push(`${where}.trigger must be one of: ${[...TRIGGERS].join(', ')}`)
    }
    if (typeof rule['require'] !== 'string' || !REQUIREMENTS.has(rule['require'])) {
      errors.push(`${where}.require must be one of: ${[...REQUIREMENTS].join(', ')}`)
    }
    if (rule['enforcement'] !== 'hard') {
      errors.push(`${where}.enforcement must be "hard" (layer-1 rules are hard by definition)`)
    }
    if (rule['remediation'] !== undefined && typeof rule['remediation'] !== 'string') {
      errors.push(`${where}.remediation must be a string when present`)
    }
  })

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, policy: input as PolicyDocument }
}
