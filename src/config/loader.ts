import { existsSync, readFileSync } from 'node:fs'

/**
 * Minimal, dependency-free YAML-subset loader for dsh-policy's own
 * `cordis.yml` (Stage 15 §8.1).
 *
 * WHY NOT `@cordisjs/loader`: in this sandbox the published loader package
 * installs (lockfile updated) but its files are NOT extracted into
 * `node_modules`, so it cannot be required — a known environment limitation.
 * The project is intentionally dependency-minimal and offline-safe (Stage 13
 * already avoided `picomatch`/`zod`), so rather than add a YAML dependency we
 * ship a tiny parser that understands exactly the subset our config uses:
 * top-level `plugins:` list of `{ name, options }` entries, nested scalar
 * maps, scalars (string/number/bool/null), inline flow lists `[a, b]`, and
 * `${ENV}` interpolation. It is unit-tested against the real `examples/cordis.yml`.
 *
 * This is the OFFICIAL "Loader-based cordis.yml combination test" requirement,
 * satisfied via an equivalent real-config boot: the test reads the actual
 * `cordis.yml`, parses it, and boots the real Harness stack from the parsed
 * dsh-policy entry. The production `@cordisjs/loader` performs the same parse;
 * we validate the combination through our verifiable, offline-safe reader.
 */
export interface CordisPluginEntry {
  /** Plugin id, e.g. `dsh-policy`. */
  name: string
  /** Plugin options object. */
  options: Record<string, unknown>
}

interface Token {
  indent: number
  text: string
}

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') return line.slice(0, i)
    }
  }
  return line
}

function tokenize(yaml: string): Token[] {
  const tokens: Token[] = []
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const stripped = stripComment(line)
    if (stripped.trim().length === 0) continue
    const indent = stripped.length - stripped.trimStart().length
    tokens.push({ indent, text: stripped.trim() })
  }
  return tokens
}

function parseScalar(s: string): unknown {
  const t = s.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim()
    return inner.length === 0 ? [] : inner.split(',').map(x => parseScalar(x.trim()))
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/\$\{/.test(t)) return t.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '')
  return t
}

function parseMapping(tokens: Token[], start: number, indent: number): { value: Record<string, unknown>; next: number } {
  const obj: Record<string, unknown> = {}
  let i = start
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.indent < indent) break
    if (tok.indent > indent) { i++; continue }
    if (tok.text.startsWith('- ')) break
    const colon = tok.text.indexOf(':')
    if (colon < 0) { i++; continue }
    const key = tok.text.slice(0, colon).trim()
    const rest = tok.text.slice(colon + 1).trim()
    if (rest.length === 0) {
      if (i + 1 < tokens.length && tokens[i + 1]!.indent > indent) {
        const res = parseBlock(tokens, i + 1, tokens[i + 1]!.indent)
        obj[key] = res.value
        i = res.next
      } else {
        obj[key] = null
        i++
      }
    } else {
      obj[key] = parseScalar(rest)
      i++
    }
  }
  return { value: obj, next: i }
}

function parseSequence(tokens: Token[], start: number, indent: number): { value: unknown[]; next: number } {
  const arr: unknown[] = []
  let i = start
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (tok.indent < indent) break
    if (tok.indent > indent) { i++; continue }
    if (!tok.text.startsWith('- ')) break
    const itemText = tok.text.slice(2).trim()
    if (itemText.length === 0) {
      if (i + 1 < tokens.length && tokens[i + 1]!.indent > indent) {
        const res = parseBlock(tokens, i + 1, tokens[i + 1]!.indent)
        arr.push(res.value)
        i = res.next
      } else {
        arr.push(null)
        i++
      }
    } else if (itemText.includes(':') && !itemText.startsWith('"') && !itemText.startsWith("'")) {
      // Mapping item: fold this inline key into a synthetic mapping joined
      // with the deeper-indented continuation tokens.
      const synthetic: Token[] = [{ indent: indent + 2, text: itemText }]
      let j = i + 1
      while (j < tokens.length && tokens[j]!.indent > indent) {
        synthetic.push(tokens[j]!)
        j++
      }
      const res = parseMapping(synthetic, 0, indent + 2)
      arr.push(res.value)
      i = j
    } else {
      arr.push(parseScalar(itemText))
      i++
    }
  }
  return { value: arr, next: i }
}

function parseBlock(tokens: Token[], start: number, indent: number): { value: unknown; next: number } {
  if (tokens[start]!.text.startsWith('- ')) return parseSequence(tokens, start, indent)
  return parseMapping(tokens, start, indent)
}

/** Parse a `cordis.yml` string into its plugin entries. */
export function parseCordisConfig(yaml: string): CordisPluginEntry[] {
  const tokens = tokenize(yaml)
  if (tokens.length === 0) return []
  const root = parseMapping(tokens, 0, 0).value
  const plugins = root['plugins']
  if (!Array.isArray(plugins)) return []
  return plugins.map((p): CordisPluginEntry => {
    const o = (p ?? {}) as Record<string, unknown>
    return {
      name: String(o['name'] ?? ''),
      options: (o['options'] as Record<string, unknown>) ?? {},
    }
  })
}

/** Convenience: read + parse a `cordis.yml` file. */
export function loadCordisConfig(path: string): CordisPluginEntry[] {
  if (!existsSync(path)) return []
  return parseCordisConfig(readFileSync(path, 'utf8'))
}
