import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/plugin/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'dist',
})
