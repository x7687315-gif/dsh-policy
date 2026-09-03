/**
 * Unified CLI entry (`dsh-policy <command>` / `pnpm exec dsh-policy ...`).
 *
 * One binary, four commands:
 *   dsh-policy init      scaffold .dsh-policy/policy.json (never overwrites)
 *   dsh-policy review    interactive/piped candidate review
 *   dsh-policy project   lifecycle registry management (pause/resume/…)
 *   dsh-policy ui        local web management UI (127.0.0.1 only)
 *
 * Single execution path: the subcommand modules export run* functions and
 * never self-execute, so this dispatcher is safe both from source (tsx) and
 * from the bundled dist/cli.mjs.
 */
export {}

const USAGE = [
  'usage: dsh-policy <command> [options]',
  '',
  '  init      scaffold .dsh-policy/policy.json in a project (--dir, --force)',
  '  review    review behavior candidates (interactive or piped)',
  '  project   lifecycle registry: pause | resume | complete | archive',
  '  ui        local web management UI (http://127.0.0.1:5178)',
  '',
  'run `dsh-policy <command>` with no options for command-specific usage.',
].join('\n')

const [, , command, ...rest] = process.argv

if (command === undefined || command === '--help' || command === '-h') {
  console.log(USAGE)
  process.exit(command === undefined ? 1 : 0)
}

switch (command) {
  case 'init': {
    const { runInitCli } = await import('./init.ts')
    await runInitCli(rest)
    break
  }
  case 'review': {
    const { runReviewCli } = await import('../review/cli.ts')
    await runReviewCli(rest)
    break
  }
  case 'project': {
    const { runProjectCli } = await import('../project/cli.ts')
    await runProjectCli(rest)
    break
  }
  case 'ui': {
    const { runUiCli } = await import('../ui/server.ts')
    await runUiCli(rest)
    break
  }
  default: {
    console.error(`unknown command: ${command}`)
    console.log(USAGE)
    process.exit(1)
  }
}

