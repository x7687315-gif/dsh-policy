/**
 * dsh-policy project lifecycle CLI (plan §Phase 14, roadmap §7.2).
 *
 * Manage a project's lifecycle state in `project-registry.json`. The plugin
 * runtime only READS this registry; this CLI is the sole writer of it AND the
 * sole mover of a project's policy directory on archive.
 *
 * Usage (via the unified CLI):
 *   dsh-policy project pause    <id> [--registry <path>]
 *   dsh-policy project resume   <id> [--registry <path>]
 *   dsh-policy project complete <id> [--registry <path>]
 *   dsh-policy project archive  <id> --dir <projectDir> [--registry <path>]
 *
 * `pause`/`complete`/`resume` only flip the state; a paused/completed/archived
 * project's rules are excluded from resolution by the plugin. `archive` additionally
 * moves `<projectDir>/.dsh-policy` into `<projectDir>/archive/` so the policy is
 * preserved (history kept) but no longer auto-discovered by the loader.
 */
import {
  archiveProject,
  loadRegistry,
  projectRegistryPath,
  saveRegistry,
  setProjectState,
  type ProjectState,
} from './registry.ts'

function argFrom(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`missing value for --${name}`)
    process.exit(1)
  }
  return value
}

function usage(): void {
  console.error([
    'usage: dsh-policy project <pause|resume|complete|archive> <id> [options]',
    '',
    '  pause    <id>  mark project paused (rules excluded from resolution)',
    '  resume   <id>  mark project active again',
    '  complete <id>  mark project completed',
    '  archive  <id>  mark archived AND move <projectDir>/.dsh-policy into <projectDir>/archive/',
    '',
    'options:',
    '  --dir <projectDir>   required for `archive`; the project root holding .dsh-policy',
    '  --registry <path>    override registry path (default ~/.dsh-policy/project-registry.json)',
  ].join('\n'))
}

/** Run the lifecycle flow. Exported for the unified CLI (`dsh-policy project ...`). */
export async function runProjectCli(argv: string[]): Promise<void> {
  const sub = argv[0]
  const id = argv[1]

  if (sub === undefined || id === undefined) {
    usage()
    process.exit(1)
  }

  const registryPath = argFrom(argv, 'registry') ?? projectRegistryPath()
  const projectDir = argFrom(argv, 'dir')

  switch (sub) {
    case 'pause':
    case 'resume':
    case 'complete': {
      const state: ProjectState = sub === 'pause' ? 'paused' : sub === 'complete' ? 'completed' : 'active'
      const next = setProjectState(loadRegistry(registryPath), id, state)
      saveRegistry(next, registryPath)
      console.log(`project "${id}" → ${state}`)
      break
    }
    case 'archive': {
      if (projectDir === undefined) {
        console.error('archive requires --dir <projectDir>')
        usage()
        process.exit(1)
      }
      archiveProject(id, projectDir, loadRegistry(registryPath), registryPath)
      console.log(`project "${id}" → archived (policy moved to ${projectDir}/archive/)`)
      break
    }
    default: {
      console.error(`unknown subcommand: ${sub}`)
      usage()
      process.exit(1)
    }
  }
}
