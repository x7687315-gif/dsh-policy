# dsh-policy

**User-controlled policy & personalization runtime for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**

A policy-driven runtime extension that lets users define project-level **hard constraints** (MUST / MUST NOT / BLOCK), manage behavioral guidance and coding preferences, and incrementally build a user-controlled personalization system — **without giving the AI autonomous authority over long-term user rules**.

> The system is not merely telling the Agent what to do. It is enforcing what the Agent is allowed to finish.

## Why

Most "memory plugins" put more user information into a prompt. This project is different: the Agent operates inside a **user-controlled policy boundary** with three layers:

| Layer | Semantics | Can block the Agent |
|---|---|---|
| 1. Project Policy (hard constraints) | `MUST` / `MUST NOT` / `BLOCK`, machine-verifiable | **Yes** |
| 2. Behavior Guard (recurring mistakes) | `WARNING` / `GUIDE` | No |
| 3. Coding Preference (style/habits) | `PREFER` / `SOFT` | No |

Priority: **Hard Project Policy > Behavioral Guidance > Coding Preference**.

Core invariants:

- **AI suggestion is not user authorization.** The AI may observe and suggest, but never silently creates/modifies/deletes durable rules.
- **Runtime truth beats model claims.** Hard rules are verified from observable tool/session events, not from the LLM saying "I did it".
- **Constraint Monotonicity.** Specific rules may add requirements but never silently weaken stronger hard rules.

It is implemented as a **native DeepSeek Harness plugin** (Cordis), not a second agent framework.

## Status

**Stage 0–16 complete — the full project plan (Phase 0–18) is implemented.** Verification baseline: `pnpm test` **145/145** across 22 files, `pnpm typecheck` clean, `pnpm build` green, `pnpm bench` full-sweep benchmark green ([report](bench/report.json), [interpretation](docs/benchmarks.md)).

**Phase 2 exit criterion achieved (2026-09-03):** integration tests against the real Harness loop prove that the Agent cannot finish a task while violating a hard project rule — and that the remediation path (run the tests → pass) unlocks completion.

- [x] Stage 0 — repository foundation
- [x] Stage 1 — Harness integration verification (turn-stopping blocking mechanism confirmed)
- [x] Stage 2 — policy & constraint engine core
- [x] Stage 3 — hard-constraint proof of concept (`code_change → tests_pass`)
- [x] Stage 4 — documentation & wrap-up
- [x] Stage 5 — generalized rule model + Constraint Monotonicity
- [x] Stage 6 — MUST NOT gate (`tools/pre-execute` deny) + rule visibility in the prompt
- [x] Stage 7 — CI (GitHub Actions) and docs sync
- [x] Stage 8 — durable session evidence, HMR safety, publishable build
- [x] Stage 9 — defect review (per-turn budget, root cleanup, strict deny trigger)
- [x] Stage 10 — behavior observation engine (zero extra LLM calls)
- [x] Stage 11 — Behavior Guard (contextual, never-blocking guidance)
- [x] Stage 12 — User Model + 🧋 Review pipeline & CLI (single write path + audit)
- [x] Audit — L1/L2 security audit: soft layers cannot gain BLOCK or bypass authorization
- [x] Hardening — R1 regex fail-fast + R2 fail-closed turn gate
- [x] Stage 13 — preference layer & Context Resolver (token budget, relevance, order 920)
- [x] Stage 14 — scopes (global/project/task) + lifecycle registry & CLI
- [x] Stage 15 — full composition: goal model, `cordis.yml`, scenarios A–E end-to-end
- [x] Stage 16 — benchmarks: constraint effectiveness / personalization effectiveness / cost

Next: **hardening & deployment** — npm publish, cloud smoke test (DeepSeek key), registered engineering debts (see [docs/PROGRESS.md](docs/PROGRESS.md)).

See [docs/PROGRESS.md](docs/PROGRESS.md) for the stage plan and next steps, [docs/architecture.md](docs/architecture.md) for the verified Harness extension seams.

## Quick start

```bash
pnpm install
pnpm test   # 145 tests (22 files) — incl. the four POC cases A/B/C/D, scenarios A–E, and pinned benchmark rates
pnpm bench  # full benchmark sweep -> bench/report.json
pnpm demo   # end-to-end: BLOCK → remediation injected → tests run → PASS
```

No API key and no local inference required: tests and the demo use a scripted LLM adapter (the only mock, per the official Harness testing philosophy).

### Enforcement behavior

```
Agent edits code                     → tools/post-execute records code_change (real tool result)
Agent says "done" without tests      → agent/turn-stopping evaluates the policy
                                     → BLOCK: remediation injected as a user message
Agent runs tests, tests fail again   → BLOCK again (within the remediation budget)
Budget exhausted while still violated → the turn can only end as an error (never a fake completion)
Agent runs tests, tests pass         → PASS: the turn may complete
Agent calls a MUST NOT tool          → tools/pre-execute denies the call before the body runs
Every step                           → the model sees the active rules in its prompt (explanation ≠ enforcement)
```

## License

[MIT](LICENSE)
