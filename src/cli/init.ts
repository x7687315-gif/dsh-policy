/**
 * `dsh-policy init` — one-command project scaffolding (Stage 18 install
 * simplification).
 *
 * Creates `.dsh-policy/policy.json` in the target directory with a working
 * starter policy, so a fresh project is enforceable in under a minute:
 *
 *   dsh-policy init [--dir <projectRoot>] [--force]
 *
 * Safety: NEVER overwrites an existing policy file (use --force to acknowledge
 * — it still validates before writing). The scaffold content is validated with
 * the same validator the plugin uses, so init can never produce a policy the
 * plugin would refuse to load.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validatePolicyDocument } from '../policy/validator.ts'
import type { PolicyDocument } from '../policy/schema.ts'

export const SCAFFOLD_POLICY: PolicyDocument = {
  project: 'my-project',
  policy: {
    hard: [
      { id: 'test-after-code-change', trigger: 'code_change', require: 'tests_pass', enforcement: 'hard' },
    ],
  },
}

export interface InitResult {
  created: boolean
  path: string
}

/** Exported (non-interactive core) so tests can drive it without spawning. */
export function runInitCore(projectRoot: string, force = false): InitResult {
  const dir = resolve(projectRoot, '.dsh-policy')
  const path = join(dir, 'policy.json')

  if (existsSync(path) && !force) {
    throw new Error(
      `refusing to overwrite existing ${path} — dsh-policy init never clobbers your policy ` +
      `(pass --force to rewrite with the scaffold after reviewing it)`,
    )
  }

  // The scaffold must itself be a valid policy — same validator, same rules.
  const validation = validatePolicyDocument(SCAFFOLD_POLICY)
  if (!validation.ok) {
    throw new Error(`internal error: scaffold policy failed validation: ${validation.errors.join('; ')}`)
  }

  mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(validation.policy, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return { created: true, path }
}

/** CLI wrapper. Exported for the unified CLI (`dsh-policy init`). */
export async function runInitCli(argv: string[]): Promise<void> {
  const dirIndex = argv.indexOf('--dir')
  const projectRoot = resolve(dirIndex === -1 ? process.cwd() : argv[dirIndex + 1] ?? process.cwd())
  const force = argv.includes('--force')

  try {
    const result = runInitCore(projectRoot, force)
    console.log(`✓ created ${result.path}`)
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  console.log(`
Next steps:
  1. Review ${join(projectRoot, '.dsh-policy', 'policy.json')} — it starts with one hard rule:
       code changes must pass the test suite before the agent may finish.
     Full schema: docs/policy.md
  2. Manage everything (rules, candidates, reminders, preferences) in the web UI:
       dsh-policy review --candidates <behaviorRoot> --model ~/.dsh-policy/user-model.json
       (or the point-and-click UI: dsh-policy ui ...)
  3. Wire the plugin into your Harness cordis.yml:
       - name: dsh-policy
         options:
           policyPath: ${join(projectRoot, '.dsh-policy', 'policy.json')}
`)
}
