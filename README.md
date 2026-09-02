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

**Phase 2 exit criterion achieved (2026-09-03):** integration tests against the real Harness loop prove that the Agent cannot finish a task while violating a hard project rule — and that the remediation path (run the tests → pass) unlocks completion.

- [x] Stage 0 — repository foundation
- [x] Stage 1 — Harness integration verification (turn-stopping blocking mechanism confirmed)
- [x] Stage 2 — policy & constraint engine core
- [x] Stage 3 — hard-constraint proof of concept (`code_change → tests_pass`)
- [x] Stage 4 — documentation & wrap-up

See [docs/PROGRESS.md](docs/PROGRESS.md) for the stage plan and next steps, [docs/architecture.md](docs/architecture.md) for the verified Harness extension seams.

## Quick start

```bash
pnpm install
pnpm test   # 18 tests — incl. the four POC cases A/B/C/D on the real Harness stack
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
