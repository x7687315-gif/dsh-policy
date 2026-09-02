import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PolicyDocument } from './schema.ts'
import { validatePolicyDocument } from './validator.ts'

export const POLICY_DIR = '.dsh-policy'
export const POLICY_FILE = 'policy.json'

export class PolicyLoadError extends Error {
  constructor(path: string, reason: string) {
    super(`dsh-policy: cannot load policy from ${path}: ${reason}`)
    this.name = 'PolicyLoadError'
  }
}

/** Conventional project policy location: `<cwd>/.dsh-policy/policy.json`. */
export function resolvePolicyPath(cwd: string = process.cwd()): string {
  return resolve(cwd, POLICY_DIR, POLICY_FILE)
}

/**
 * Read and validate a policy file. Throws `PolicyLoadError` when the file is
 * unreadable, not JSON, or fails schema validation — a broken policy must be
 * loud, never silently ignored.
 */
export function loadPolicyFile(path: string): PolicyDocument {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new PolicyLoadError(path, error instanceof Error ? error.message : String(error))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new PolicyLoadError(path, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const validation = validatePolicyDocument(parsed)
  if (!validation.ok) {
    throw new PolicyLoadError(path, validation.errors.join('; '))
  }
  return validation.policy
}
