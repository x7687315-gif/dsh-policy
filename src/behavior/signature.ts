/**
 * Pattern signatures — the dedup/aggregation key for observations.
 * Same signature ⇒ same candidate, so signature design IS the dedup policy.
 */
export type RemedyKind = 'remediation_repeated' | 'hard_block_repeated'

/** Enforcement signals aggregate per violated rule id. */
export function ruleSignature(kind: RemedyKind, ruleId: string): string {
  return `${kind}:${ruleId}`
}

/** Forbidden-tool signals aggregate per tool name. */
export function toolDenySignature(tool: string): string {
  return `tool_denied_repeated:${tool}`
}

/**
 * Normalize a free-text correction into a stable signature:
 * lowercase, numbers and paths collapsed to a placeholder, punctuation
 * stripped (CJK preserved), first 8 words kept. "又改错了 /a/b/c" and
 * "又改错了 /x/y" land on the same signature; genuinely different
 * corrections do not.
 */
export function correctionSignature(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\/[\w./\\-]+/g, ' # ')
    .replace(/\b\d+\b/g, ' # ')
    .replace(/[^a-z0-9\u4e00-\u9fff#]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .slice(0, 8)
    .join(' ')
  return `user_correction:${normalized}`
}

/** Human-readable subject of a signature (for draft messages). */
export function signatureSubject(signature: string): string {
  return signature.split(':').slice(1).join(':')
}
