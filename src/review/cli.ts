/**
 * 🧋 dsh-policy review CLI (plan §Phase 10, roadmap §5).
 *
 * Thin interactive shell over the pure review pipeline: lists pending
 * candidates with their evidence, then applies the user's decisions to the
 * durable user model. This process is the ONLY writer of user state.
 *
 * Usage:
 *   pnpm tsx src/review/cli.ts --candidates <behaviorRoot> --model <userModelJson>
 *
 * Answers per candidate: y | e <message> | n | s   (confirm / edit / reject / skip)
 * Interactive on a TTY; with piped stdin, answers are consumed line by line
 * (missing answers count as skip).
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { createBehaviorRuntime } from '../behavior/wire.ts'
import { BehaviorStore } from '../behavior/store.ts'
import { UserModelStore } from '../usermodel/store.ts'
import type { CandidateBehavior } from '../behavior/types.ts'
import { applyReview, type ReviewAction, type ReviewDecision } from './review.ts'

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || process.argv[index + 1] === undefined) {
    console.error(`missing required --${name} argument`)
    process.exit(1)
  }
  return process.argv[index + 1]!
}

type ParsedAnswer = { action: Exclude<ReviewAction, 'edit'> } | { action: 'edit'; message: string }

function parseAnswer(answer: string): ParsedAnswer {
  const trimmed = answer.trim()
  const lowered = trimmed.toLowerCase()
  if (lowered === 'y' || lowered === 'yes' || lowered === 'confirm') return { action: 'confirm' }
  if (lowered === 'n' || lowered === 'no' || lowered === 'r' || lowered === 'reject') return { action: 'reject' }
  if (lowered === 'e' || lowered.startsWith('e ') || lowered.startsWith('edit')) {
    const message = lowered.startsWith('edit') ? trimmed.slice(4).trim() : trimmed.slice(1).trim()
    return { action: 'edit', message: message.length > 0 ? message : 'Confirmed after review.' }
  }
  return { action: 'skip' }
}

const candidatesRoot = arg('candidates')
const modelPath = arg('model')

const candidates: CandidateBehavior[] = new BehaviorStore(candidatesRoot).loadCandidates()
if (candidates.length === 0) {
  console.log('🧋 Nothing to review — no pending candidates.')
  process.exit(0)
}

const store = new UserModelStore(modelPath)
const behavior = createBehaviorRuntime({ enabled: true, root: candidatesRoot })

function printCandidate(candidate: CandidateBehavior): void {
  console.log('─'.repeat(72))
  console.log(`🧋 ${candidate.id}`)
  console.log(`   kind=${candidate.kind}  occurrences=${candidate.occurrences}  sessions=${candidate.distinctSessions}  confidence=${candidate.confidence}`)
  for (const evidence of candidate.evidence) {
    console.log(`   · [${evidence.sessionId}] ${evidence.detail}`)
  }
  console.log(`   draft: ${candidate.draftMessage}`)
}

function toDecision(candidate: CandidateBehavior, parsed: ParsedAnswer): ReviewDecision {
  return parsed.action === 'edit'
    ? { candidateId: candidate.id, action: 'edit', message: parsed.message }
    : { candidateId: candidate.id, action: parsed.action }
}

async function main(): Promise<void> {
  const decisions: ReviewDecision[] = []

  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout })
    for (const candidate of candidates) {
      printCandidate(candidate)
      const answer = await rl.question('   [y] confirm / [e <msg>] edit / [n] reject / [s] skip > ')
      decisions.push(toDecision(candidate, parseAnswer(answer)))
    }
    rl.close()
  } else {
    // Piped mode: consume all lines first (deterministic, scriptable).
    const lines: string[] = []
    await new Promise<void>(resolve => {
      let buffer = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (chunk: string) => {
        buffer += chunk
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        lines.push(...parts)
      })
      stdin.on('end', resolve)
    })
    for (const candidate of candidates) {
      printCandidate(candidate)
      decisions.push(toDecision(candidate, parseAnswer(lines.shift() ?? '')))
    }
  }

  const outcomes = applyReview(candidates, store, decisions, { via: 'review-cli', note: 'review' }, {
    onReject: signature => behavior?.reject(signature),
  })

  console.log('═'.repeat(72))
  for (const outcome of outcomes) {
    console.log(`${outcome.result.padEnd(16)} ${outcome.candidateId}${outcome.recordId !== undefined ? ` → ${outcome.recordId}` : ''}`)
  }
  console.log(`\nUser model: ${modelPath}`)
}

await main()
