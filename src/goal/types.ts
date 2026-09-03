/**
 * Goal model (plan §Phase 15, roadmap §7.3) — MINIMAL by design.
 *
 * A goal is a user-authored node in a 4-level tree (long-term → milestone →
 * short-term → today's task). The system NEVER plans or decomposes: it only
 * (a) lets a task explicitly link to a goal and (b) injects ONE line of goal
 * context into the prompt when that link exists. Decomposition is driven by
 * the user; the runtime merely provides the linkage and the backfill.
 */
export interface GoalNode {
  /** Stable id — tasks reference goals by this id. */
  id: string
  /** Parent goal id in the tree, or null for a root node. */
  parentId: string | null
  /** Human title shown in the single injected line. */
  title: string
  /** Optional owning project (scope tag; not used for enforcement). */
  projectId?: string
  /** Task ids explicitly linked to this goal. */
  linkedTaskIds: string[]
}
