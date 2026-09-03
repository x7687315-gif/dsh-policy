import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PolicyDocument } from './schema.ts'
import { validatePolicyDocument } from './validator.ts'

export const POLICY_DIR = '.dsh-policy'
export const POLICY_FILE = 'policy.json'

/** Default global-scope policy location: `~/.dsh-policy/policy.json`. */
export function globalPolicyPath(home: string = homedir()): string {
  return resolve(home, POLICY_DIR, POLICY_FILE)
}

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

/**
 * Read the global-scope policy from `~/.dsh-policy/policy.json`.
 *
 * Global policy is OPTIONAL: when the file is absent, returns `undefined` and
 * the plugin enforces only project/task rules. When the file exists but is
 * unreadable, not JSON, or fails schema validation, it throws `PolicyLoadError`
 * (a broken global policy must be loud, never silently skipped — same
 * discipline as the project policy).
 */
export function loadGlobalPolicy(home: string = homedir()): PolicyDocument | undefined {
  const path = globalPolicyPath(home)
  if (!existsSync(path)) return undefined
  return loadPolicyFile(path)
}
