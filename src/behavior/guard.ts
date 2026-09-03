/**
 * Behavior Guard (plan §Phase 8): user-confirmed guidance that is CONTEXTUAL
 * and NEVER BLOCKING. Type-isolated from hard rules on purpose — a guard can
 * never enter the constraint engine (evaluatePolicy only accepts Resolution
 * built from HardRule), so "guidance becomes an accidental hard gate" is
 * impossible at compile time, not just at runtime.
 */
export interface BehaviorGuardTrigger {
  /** Remind right after one of these tools executed (post-execute channel). */
  tools?: string[]
  /** Remind while the latest user message matches (prompt channel). */
  taskRegex?: string
  /** Remind in every assembly. */
  always?: boolean
}

export interface BehaviorGuardRule {
  id: string
  /** Model-visible reminder text. */
  message: string
  trigger: BehaviorGuardTrigger
  /** Only affects wording prefix and ordering — never the channel. */
  severity?: 'info' | 'warn'
  enabled?: boolean
  /** Where this guard came from (Stage 12: the confirmed candidate). */
  provenance?: {
    candidateId?: string
    confirmedAt?: number
  }
}

/** Enabled guards only. */
export function liveGuards(guards: readonly BehaviorGuardRule[]): BehaviorGuardRule[] {
  return guards.filter(guard => guard.enabled !== false)
}

/** Guards relevant to the current task text (taskRegex channel; invalid regex = no match). */
export function taskGuardsFor(guards: readonly BehaviorGuardRule[], taskText: string): BehaviorGuardRule[] {
  return liveGuards(guards).filter(guard => {
    const pattern = guard.trigger.taskRegex
    if (pattern === undefined) return false
    try {
      return new RegExp(pattern, 'i').test(taskText)
    } catch {
      return false // an invalid pattern must never throw into the assembly path
    }
  })
}

/** Guards relevant to a just-executed tool (post-execute channel). */
export function toolGuardsFor(guards: readonly BehaviorGuardRule[], tool: string): BehaviorGuardRule[] {
  return liveGuards(guards).filter(guard => guard.trigger.tools?.includes(tool) === true)
}

/** Guards that render in every assembly. */
export function alwaysGuards(guards: readonly BehaviorGuardRule[]): BehaviorGuardRule[] {
  return liveGuards(guards).filter(guard => guard.trigger.always === true)
}

/**
 * Prompt-channel text for the guards active right now. Rendered into the
 * `dsh-policy/guards` prompt context (order 910 — AFTER hard rules at 900,
 * BEFORE preferences at 920): physical prompt order mirrors layer priority.
 */
export function guardContextText(active: readonly BehaviorGuardRule[]): string {
  if (active.length === 0) return ''
  const lines = ['[dsh-policy] Behavior guidance (non-binding, from your confirmed preferences):']
  for (const guard of active) {
    const prefix = guard.severity === 'warn' ? 'warning' : 'note'
    lines.push(`- (${prefix}) ${guard.message}`)
  }
  return lines.join('\n')
}

/** Post-execute channel text for one tool guard. */
export function guardReminderText(guard: BehaviorGuardRule): string {
  return `[dsh-policy] Reminder (guidance, not a rule): ${guard.message}`
}
