import { extname } from 'node:path'
import type { Resolution } from '../policy/resolver.ts'
import { summarizeRules } from '../policy/resolver.ts'
import type { BehaviorGuardRule } from '../behavior/guard.ts'
import { alwaysGuards, guardContextText, taskGuardsFor } from '../behavior/guard.ts'
import type { ResolvedPreference } from '../usermodel/preferences.ts'
import type { GoalNode } from '../goal/types.ts'

/**
 * Context Resolver (plan §Phase 11-12, roadmap §6.2) — the project's
 * "anti-memory-dump" module. Given the current task profile and the three
 * rule layers, it returns the *minimal* context bundle: every hard rule
 * (unconditionally), only the guards/preferences relevant to THIS task, and
 * never more than the token budget allows.
 *
 * Everything here is deterministic and LLM-free (plan Phase 18: zero extra
 * LLM calls). Relevance matching reuses the exact guard-matching functions
 * from `behavior/guard.ts` so the prompt channel stays byte-identical to the
 * existing 910 path.
 */

export interface TaskProfile {
  /** Latest user message — the taskRegex channel matches against it. */
  userMessage: string
  /** Recent files touched this session (extensions map to languages). */
  recentFiles: string[]
  /** Recent tools executed this session. */
  recentTools: string[]
}

export interface ResolveContextInput {
  taskProfile: TaskProfile
  /** Hard rules — always included, never evicted. */
  resolution: Resolution
  /** Behavior guards — matched by trigger (always / taskRegex). */
  guards: BehaviorGuardRule[]
  /** User preferences — matched by `appliesTo`. */
  preferences: ResolvedPreference[]
  /** Token budget ceiling (default 800, roadmap §6.2). */
  tokenBudget?: number
  /**
   * Goal model (plan §Phase 15, roadmap §7.3): the read-only goal projection.
   * The resolver injects AT MOST ONE line of goal context — and only when the
   * current task explicitly links to a goal (see `linkedGoalIds`). No
   * auto-planning, no decomposition: the system only surfaces the link.
   */
  goals?: GoalNode[]
  /** Goal ids the current task explicitly links to. Empty/absent → no injection. */
  linkedGoalIds?: string[]
}

export interface ContextSection {
  name: string
  text: string
  order: number
}

export interface ContextBundle {
  sections: ContextSection[]
  /** Present only when the budget forced eviction. */
  truncation?: { omittedCount: number }
}

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.json': 'json', '.md': 'markdown',
}

const DEFAULT_BUDGET = 800
const TOKEN_MARGIN = 1.15

const LAYER_ORDER = { hard: 900, guard: 910, preference: 920, goal: 925 } as const
const LAYER_HEADER: Record<'hard' | 'guard' | 'preference' | 'goal', string> = {
  hard: '[dsh-policy] Active hard project rules (runtime-enforced, not optional):',
  guard: '[dsh-policy] Behavior guidance (non-binding, from your confirmed preferences):',
  preference: '[dsh-policy] Preferences (your confirmed, non-binding soft guidance):',
  goal: '[dsh-policy] Linked goal (task-explicit context only, no planning):',
}

interface BundleItem {
  layer: 'hard' | 'guard' | 'preference'
  text: string
  /** Higher = kept first under the budget. */
  priority: number
  /** Higher = more recent; tie-breaker for keeping. */
  recency: number
  /** Hard items are never evictable (plan §6.2). */
  evictable: boolean
  dropped?: boolean
}

/** chars/3.5 is a rough token estimate; we add a 15% safety margin. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil((text.length / 3.5) * TOKEN_MARGIN)
}

/**
 * Minimal glob → RegExp (supports `**`, `*`, `?`). Deliberately dependency-free
 * (roadmap §6.2 names `picomatch`, but the project is intentionally
 * dependency-minimal and offline-safe; this covers the '**' and '*.ext' glob shapes
 * shapes the resolver needs). Swappable for `picomatch` in Stage 14 if wanted.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++ }
      else out += '[^/\\\\]*'
    } else if (c === '?') {
      out += '[^/\\\\]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  out += '$'
  return new RegExp(out)
}

/** A bad user-supplied regex must never throw into the assembly path. */
function safeRegexTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text)
  } catch {
    return false
  }
}

/** Deterministic relevance of a preference to the current task (no LLM). */
export function matchPreference(p: ResolvedPreference, task: TaskProfile): boolean {
  const { language, fileGlob, taskRegex } = p.appliesTo ?? {}
  // No constraint → unconditional, always relevant.
  if (!language && (!fileGlob || fileGlob.length === 0) && !taskRegex) return true
  if (language) {
    const langs = new Set(task.recentFiles.map(f => EXT_TO_LANG[extname(f)]).filter(Boolean))
    if (langs.has(language)) return true
  }
  if (fileGlob && fileGlob.length > 0) {
    const matchers = fileGlob.map(globToRegExp)
    if (task.recentFiles.some(f => matchers.some(re => re.test(f)))) return true
  }
  if (taskRegex && safeRegexTest(taskRegex, task.userMessage)) return true
  return false
}

/**
 * Goal context (plan §Phase 15, roadmap §7.3). Returns AT MOST ONE line, and
 * ONLY when the current task explicitly links to a goal. Missing goals,
 * empty link list, or no matching goal all yield the empty string — the
 * resolver then injects nothing. No auto-planning, no decomposition.
 */
export function goalContextText(
  goals: readonly GoalNode[] | undefined,
  linkedGoalIds: readonly string[] | undefined,
): string {
  if (goals === undefined || linkedGoalIds === undefined || linkedGoalIds.length === 0) return ''
  const linked = goals.filter(g => linkedGoalIds.includes(g.id))
  if (linked.length === 0) return ''
  const titles = linked.map(g => g.title).join('；')
  return `${LAYER_HEADER.goal} ${titles}`
}

function renderLayer(layer: 'hard' | 'guard' | 'preference', items: BundleItem[]): string {
  if (items.length === 0) return ''
  return [LAYER_HEADER[layer], ...items.map(item => `- ${item.text}`)].join('\n')
}

/**
 * Produce the minimal context bundle for the current task.
 *
 * Token budget eviction (roadmap §6.2): when over budget, the LEAST important
 * evictable item is dropped first — lowest priority, then oldest recency.
 * Hard items are `evictable: false`, so they can never be removed; the
 * preference/guard layers absorb the whole budget squeeze. A `(+k rules
 * omitted)` note is appended to the last surviving section.
 */
export function resolveContext(input: ResolveContextInput): ContextBundle {
  const budget = input.tokenBudget ?? DEFAULT_BUDGET

  const hardText = summarizeRules(input.resolution)
  // Prompt-channel guard relevance mirrors the existing 910 path exactly
  // (always + taskRegex); tool-triggered guards live on the post-execute
  // additionalContexts channel and are intentionally not in the prompt bundle.
  const matchedGuards = [...alwaysGuards(input.guards), ...taskGuardsFor(input.guards, input.taskProfile.userMessage)]
  const guardText = guardContextText(matchedGuards)

  const matchedPrefs = input.preferences
    .filter(p => matchPreference(p, input.taskProfile))
    .sort((a, b) => b.priority - a.priority || b.recency - a.recency)

  const items: BundleItem[] = []
  if (hardText.length > 0) {
    items.push({ layer: 'hard', text: hardText, priority: Number.POSITIVE_INFINITY, recency: Number.POSITIVE_INFINITY, evictable: false })
  }
  if (guardText.length > 0) {
    items.push({ layer: 'guard', text: guardText, priority: 0, recency: 0, evictable: true })
  }
  for (const p of matchedPrefs) {
    items.push({ layer: 'preference', text: p.text, priority: p.priority, recency: p.recency, evictable: true })
  }

  let used = items.reduce((sum, it) => sum + estimateTokens(it.text), 0)
  let omitted = 0
  if (used > budget) {
    const evictable = items
      .map((item, idx) => ({ item, idx }))
      .filter(entry => entry.item.evictable && !entry.item.dropped)
      .sort((x, y) => x.item.priority - y.item.priority || x.item.recency - y.item.recency)
    for (const entry of evictable) {
      if (used <= budget) break
      const item = items[entry.idx]!
      used -= estimateTokens(item.text)
      items[entry.idx] = { ...item, dropped: true }
      omitted++
    }
  }

  const sections: ContextSection[] = []
  const hard = items.find(i => i.layer === 'hard' && !i.dropped)
  const guard = items.find(i => i.layer === 'guard' && !i.dropped)
  const prefs = items.filter(i => i.layer === 'preference' && !i.dropped)
  if (hard) sections.push({ name: 'dsh-policy', text: hard.text, order: LAYER_ORDER.hard })
  if (guard) sections.push({ name: 'dsh-policy/guards', text: guard.text, order: LAYER_ORDER.guard })
  if (prefs.length > 0) {
    sections.push({ name: 'dsh-policy/preferences', text: renderLayer('preference', prefs), order: LAYER_ORDER.preference })
  }
  // Goal context: one line, only when the task explicitly links to a goal
  // (roadmap §7.3). Kept out of the eviction logic — it is the whole point of
  // the feature and is present only on explicit linkage.
  const goalText = goalContextText(input.goals, input.linkedGoalIds)
  if (goalText.length > 0) {
    sections.push({ name: 'dsh-policy/goal', text: goalText, order: LAYER_ORDER.goal })
  }
  if (omitted > 0) {
    const last = sections[sections.length - 1]
    if (last) last.text += `\n(+${omitted} rules omitted to stay within the ${budget}-token budget)`
  }

  return omitted > 0 ? { sections, truncation: { omittedCount: omitted } } : { sections }
}
