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

Under active development. See [docs/PROGRESS.md](docs/PROGRESS.md) for the stage plan and [docs/project-plan.md](docs/project-plan.md) for the full specification.

- [x] Stage 0 — repository foundation
- [ ] Stage 1 — Harness integration verification
- [ ] Stage 2 — policy & constraint engine core
- [ ] Stage 3 — hard-constraint proof of concept (`code_change → tests_pass`)
- [ ] Stage 4 — documentation & wrap-up

## License

[MIT](LICENSE)
