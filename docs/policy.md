# Writing Project Policies (.dsh-policy/policy.json)

A policy file is **data the runtime enforces**, not documentation the model may ignore. This guide covers the v1 schema validated by `src/policy/validator.ts`.

## Location

```
your-project/
└── .dsh-policy/
    └── policy.json
```

`dsh-policy` loads this file automatically when no inline `policy` / `policyPath` option is given. A broken file fails LOUDLY (the plugin refuses to start) — a silently ignored policy would be worse than none.

## Schema

```jsonc
{
  "project": "my-api",              // required, non-empty
  "scope": "project",               // optional: "global" | "project" (default "project")

  "evidence": {                     // optional: how runtime facts are recognized
    "codeChangeTools": ["edit_file", "write_file", "apply_patch"],
    "verificationTools": [
      { "tool": "run_tests",  "passPattern": "\\bPASSED\\b" },
      { "tool": "typecheck",  "passPattern": "\\bNO ISSUES\\b" }
    ]
  },

  "policy": {
    "hard": [                       // layer 1 — the only layer with veto power
      {
        "id": "test-after-code-change",        // unique, stable, diff-friendly
        "trigger": "code_change",              // arms the rule
        "require": "tests_pass",               // built-in: tests_pass | typecheck_pass
        "enforcement": "hard",                 // always "hard" in layer 1
        "enabled": true,                       // optional (default true)
        "remediation": "Run pnpm test and make it pass."  // optional, model-visible
      },
      {
        "id": "typecheck-required",
        "trigger": "code_change",
        "require": { "kind": "tool_pass", "tool": "typecheck", "passPattern": "\\bNO ISSUES\\b" },
        "enforcement": "hard"
      },
      {
        "id": "no-dangerous-commands",
        "trigger": "always",
        "denyTools": ["drop_database", "rm_rf"],
        "enforcement": "hard",
        "remediation": "This command is forbidden by project policy."
      }
    ]
  }
}
```

## How each rule is enforced

| Rule kind | Enforced at | Effect |
|---|---|---|
| `require` (tool-pass) | `agent/turn-stopping` | Turn cannot complete until a passing run of the required tool is recorded **after** the last code change. Within the remediation budget the agent is injected a corrective message; past the budget the turn can only end as an error. |
| `denyTools` (MUST NOT) | `tools/pre-execute` | The call is denied **before the tool body runs**; the model sees the deny reason. |

Verification always reads **real tool results** (`result.value` + `passPattern`), never the model's claims.

## Scope and Constraint Monotonicity

More specific scopes (project, later: task) may **add** hard rules but can never weaken a stronger scope. If the same rule id appears in two scopes, the stronger scope's version is kept and the conflict is reported — a "local exception" that would silently punch a hole in a hard rule is refused by design.

## Authoring guidelines

1. **One concern per rule.** `test-after-code-change` and `typecheck-required` are two rules, not one.
2. **Machine-verifiable or it doesn't belong in `hard`.** If a human must judge it, it's layer 2 (Behavior Guard) material, not layer 1.
3. **`passPattern` must match the tool's real success output**, not a best-effort guess. Check what your test runner actually prints.
4. **`denyTools` is for irreversible or destructive tools**, not style choices.
5. **Write `remediation` as an instruction, not an apology** — it is injected verbatim when the rule blocks the agent.
6. **Every hard rule should have a test** (plan §11.4). See `tests/integration/poc.test.ts` for the four-case pattern: pass / fail / missing / not-triggered.
