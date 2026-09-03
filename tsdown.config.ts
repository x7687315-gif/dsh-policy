import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    // library entry (imports resolve via the package exports map)
    index: 'src/plugin/index.ts',
    // unified CLI entry (bin/dsh-policy.mjs wraps this with a node shebang)
    cli: 'src/cli/main.ts',
  },
  format: 'esm',
  dts: true,
  outDir: 'dist',
})
