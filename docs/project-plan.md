# DSH Policy & Personalization Runtime

> **Project working title:** User-Controlled Policy & Personalization Runtime for DeepSeek Harness
>
> **Project positioning:** A policy-driven runtime extension for DeepSeek Harness that lets users define project-level hard constraints, manage behavioral guidance and coding preferences, and incrementally build a user-controlled personalization system without giving AI autonomous authority over long-term user rules.

---

## 1. Why this project exists

This project is not intended to be another "memory plugin" that simply puts more user information into an LLM prompt.

The core idea is that an Agent should operate inside a **user-controlled policy boundary**.

The project has three layers:

```text
┌────────────────────────────────────────────┐
│ Layer 1 — Project Policy                   │
│ Hard constraints                            │
│ MUST / MUST NOT / BLOCK                    │
│                                            │
│ The project requirements the Agent must    │
│ obey while working on the project.         │
└──────────────────────┬─────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────┐
│ Layer 2 — Behavior Guard                   │
│ Behavioral defects / recurring mistakes    │
│ WARNING / GUIDE                             │
│                                            │
│ Helps the user avoid known recurring       │
│ mistakes without pretending they are       │
│ project-level hard requirements.           │
└──────────────────────┬─────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────┐
│ Layer 3 — Coding Preference                │
│ User habits / style preferences            │
│ PREFER / SOFT                               │
│                                            │
│ Influences how the Agent works, but        │
│ normally should not block a task.          │
└──────────────────────┬─────────────────────┘
                       │
                       ▼
                    Agent / LLM
```

The priority is:

> **Hard Project Policy > Behavioral Guidance > Coding Preference**

Only the first layer has veto power over Agent execution.

---

## 2. Core principles

### 2.1 User control is the source of authority

The AI may observe, analyze, suggest, and explain. It must not silently create, modify, strengthen, weaken, or delete durable user-controlled rules.

A durable rule becomes authoritative through explicit user control.

### 2.2 JSON is the policy carrier, not the enforcement mechanism

The policy can be represented by JSON because JSON is easy to inspect, version, diff, test, and commit.

However:

> A JSON file alone is not enforcement.

Real enforcement comes from a runtime Constraint Engine integrated with DeepSeek Harness lifecycle and tool/event boundaries.

### 2.3 Hard rules must be machine-verifiable whenever possible

A hard rule should preferably be evaluated from observable runtime facts rather than the LLM saying that it complied.

Bad verification:

```text
Agent: "I already ran the tests."
→ accept
```

Preferred verification:

```text
test tool executed
        ↓
test result recorded
        ↓
status = passed
        ↓
constraint satisfied
```

### 2.4 Do not build a large architecture before proving the core

The first engineering milestone is not UI, memory, or personalization.

The first milestone is:

> **Can a DeepSeek Harness extension actually prevent a task/turn from finishing while a hard project rule is violated?**

If this cannot be proven, the rest of the architecture is premature.

### 2.5 Specific rules must not silently weaken stronger constraints

A project-specific or task-specific rule may add requirements, but it must not silently override a higher-level hard rule.

This principle is called:

> **Constraint Monotonicity**

---

# 3. Relationship to DeepSeek Harness

DeepSeek Harness is itself built around Cordis and plugin-based extension points. The official architecture describes plugins as contributors of services, typed events, and reversible effects; the model adapter, tool registry, session log, and agent loop are all extensible rather than being a privileged monolithic core. citehttps://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md

Relevant extension concepts include:

- `core/session` — append-only session event log
- `core/system-prompt` — prompt-section and tool-schema assembly
- `core/tools` — scoped tool registry and guarded execution pipeline
- `core/agent` — Agent interface and lifecycle events
- `core/agent-loop` — default driver
- `llm/llm` — model/stream adapter seam

The official turn flow includes extension points such as `agent/pre-step`, `agent/request`, tool execution hooks, and the serial `agent/turn-stopping` checkpoint. citehttps://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md

The tool pipeline also contains `tools/pre-execute` and `tools/post-execute`, making tool-level policy enforcement possible without modifying the Agent loop directly. citehttps://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md

This project should therefore be implemented as a **native Harness extension/plugin**, not as a second independent Agent framework.

---

# 4. Target architecture

```text
                              USER
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
             ▼                                   ▼
      Project Policy                         User Model
             │                                   │
             │                        ┌──────────┴──────────┐
             │                        │                     │
             │                        ▼                     ▼
             │                  Behavior Patterns      Preferences
             │
             ▼
       Policy Resolver
             │
             ├───────────────┐
             │               │
             ▼               ▼
      Hard Constraints    Soft Guidance
             │               │
             ▼               ▼
       Constraint Engine   Context Resolver
             │               │
             └───────┬───────┘
                     │
                     ▼
              DeepSeek Harness
                     │
           ┌─────────┴──────────┐
           │                    │
           ▼                    ▼
         Agent              Runtime Events
           │                    │
           ▼                    ├──────────────┐
          LLM                   │              │
                                ▼              ▼
                         Observation Engine   Verifiers
                                │              │
                                ▼              │
                           Candidate           │
                                │              │
                                ▼              │
                         🧋 Daily Review       │
                                │              │
                        User confirms         │
                                │              │
                                ▼              │
                          User Model           │
                                               │
                                               └──────► Constraint Engine
```

The observation/review loop is intentionally separate from hard enforcement:

```text
Runtime Event
     ↓
Observation
     ↓
Candidate
     ↓
🧋 Daily Review
     ↓
User confirms / edits / rejects
     ↓
Durable User Model
```

---

# 5. The three-layer policy model

## Layer 1 — Project Policy

### Purpose

Represent the requirements that apply to an entire project and that the Agent must obey.

### Semantics

- `MUST`
- `MUST NOT`
- `BLOCK`
- machine-verifiable whenever possible
- user-controlled
- versionable
- auditable

### Example

```json
{
  "project": "my-api",
  "policy": {
    "hard": [
      {
        "id": "test-after-code-change",
        "trigger": "code_change",
        "require": "tests_pass"
      },
      {
        "id": "typecheck-required",
        "trigger": "code_change",
        "require": "typecheck_pass"
      }
    ]
  }
}
```

## Layer 2 — Behavior Guard

### Purpose

Represent recurring user mistakes or behavior patterns that should trigger warnings or guidance.

### Semantics

- `WARNING`
- `GUIDE`
- `SUGGEST`
- usually non-blocking
- AI may detect candidates
- user must approve durable rules

### Example

```json
{
  "id": "check-callers",
  "type": "behavior",
  "trigger": "api_change",
  "message": "Check affected callers after changing the API."
}
```

## Layer 3 — Coding Preference

### Purpose

Represent the user's preferred coding style and working habits.

### Semantics

- `PREFER`
- `SOFT`
- generally non-blocking
- can be overridden by project constraints or task reality

### Example

```json
{
  "id": "prefer-async-await",
  "type": "preference",
  "value": "async-await"
}
```

---

# 6. Authority and mutation rules

| Layer | Example | AI can observe | AI can suggest | AI can autonomously modify durable state | Can block Agent |
|---|---|---:|---:|---:|---:|
| Project Policy | Tests must pass after code changes | Yes | Yes | **No** | **Yes** |
| Behavior Guard | Remember to check API callers | Yes | Yes | **No** | No |
| Coding Preference | Prefer async/await | Yes | Yes | **No** | No |

The most important invariant is:

> **AI suggestion is not user authorization.**

A detected pattern can become a durable Behavior Guard only after user confirmation.

The same principle applies to Project Policy: the Agent cannot silently promote a behavior into a hard rule.

---

# 7. Example end-to-end enforcement

Consider the hard rule:

```json
{
  "id": "test-after-code-change",
  "trigger": "code_change",
  "enforcement": "hard",
  "require": "tests_pass"
}
```

Execution:

```text
START
  ↓
TASK_ACTIVE
  ↓
code changed
  ↓
Constraint Engine
  ↓
Is a valid test execution recorded?
  ├── NO → BLOCK
  └── YES
        ↓
     Did tests pass?
        ├── NO → BLOCK
        └── YES → PASS
                         ↓
                    TASK_COMPLETE
```

If blocked:

```text
BLOCK
  ↓
Remediation instruction
  ↓
Agent executes required action
  ↓
Runtime event recorded
  ↓
Constraint Engine checks again
  ↓
PASS / BLOCK
```

The goal is to make this behavior testable in an automated integration test.

---

# 8. Proposed repository structure

Do **not** create every directory immediately. Create structure according to the current milestone.

The eventual structure may look like:

```text
DSH-Policy-Personalization/
├── src/
│   ├── plugin/
│   │   └── index.ts
│   ├── policy/
│   │   ├── loader.ts
│   │   ├── resolver.ts
│   │   └── validator.ts
│   ├── enforcement/
│   │   └── constraint-engine.ts
│   ├── behavior/
│   │   ├── observer.ts
│   │   ├── candidate.ts
│   │   └── guard.ts
│   ├── preference/
│   │   └── resolver.ts
│   ├── project/
│   │   ├── project.ts
│   │   ├── rules.ts
│   │   └── lifecycle.ts
│   ├── context/
│   │   └── resolver.ts
│   ├── goal/
│   │   └── decomposition.ts
│   └── storage/
│       └── store.ts
├── tests/
├── examples/
│   └── amiya/
├── docs/
│   ├── architecture.md
│   ├── policy.md
│   ├── user-model.md
│   ├── project-rules.md
│   └── design-principles.md
├── README.md
├── package.json
└── tsconfig.json
```

The first implementation should be much smaller than this.

---

# 9. Development roadmap

## Phase 0 — Project foundation

### Goal

Create the independent open-source repository and make the problem statement explicit.

### Tasks

- [ ] Create independent GitHub repository.
- [ ] Choose final project name.
- [ ] Add `README.md`.
- [ ] Add this project plan as a development specification.
- [ ] Add license.
- [ ] Add contribution guidelines.
- [ ] Add issue templates when the project becomes public.
- [ ] Decide initial package manager and TypeScript target.
- [ ] Write the first architecture note.

### Exit criterion

A stranger can open the repository and understand:

1. what problem it solves;
2. why it is different from ordinary memory/prompt systems;
3. why it is built as a DeepSeek Harness extension;
4. how to run the first proof of concept.

---

## Phase 1 — DeepSeek Harness architecture verification

### Goal

Understand the real extension APIs before writing the Constraint Engine.

### Tasks

- [ ] Inspect the current Harness source and extension cookbook.
- [ ] Identify the exact plugin registration API.
- [ ] Confirm how `agent/pre-step` is registered and what decisions it can make.
- [ ] Confirm how `agent/turn-stopping` can prevent natural turn completion and steer another step.
- [ ] Confirm `tools/pre-execute` behavior for tool-level hard gates.
- [ ] Confirm `tools/post-execute` behavior for result inspection/context injection.
- [ ] Identify which events are durable session events versus live extension points.
- [ ] Record findings in `docs/architecture.md`.

### Exit criterion

We can point to concrete Harness APIs for:

- observing runtime events;
- injecting model-visible context;
- denying a tool execution;
- inspecting results;
- intercepting or steering turn completion.

Do not implement speculative hooks based only on conceptual diagrams.

---

## Phase 2 — Hard Constraint Proof of Concept

### Goal

Prove the core thesis of the project.

### Only rule required initially

```text
code_change → tests_pass
```

### Tasks

- [ ] Define the smallest possible hard-rule schema.
- [ ] Load one JSON policy.
- [ ] Observe code modification/tool events.
- [ ] Track whether a required test execution happened.
- [ ] Track whether the test passed.
- [ ] Implement a real blocking gate at the verified Harness lifecycle point.
- [ ] Produce a remediation path when blocked.
- [ ] Add integration tests for pass/fail/missing-test cases.

### Required tests

```text
Case A: code changed + tests pass
→ Agent may complete.

Case B: code changed + tests failed
→ Agent cannot complete.

Case C: code changed + no tests
→ Agent cannot complete.

Case D: no code change
→ test-after-code-change rule is not triggered.
```

### Exit criterion

**A test proves that the Agent cannot successfully finish while violating the hard Project Policy.**

This is the first major public milestone.

---

## Phase 3 — Constraint Rule Model

### Goal

Turn the POC into a reusable rule engine.

### Tasks

- [ ] Define `Rule` type.
- [ ] Define `RuleScope`.
- [ ] Define trigger model.
- [ ] Define requirement model.
- [ ] Define enforcement levels.
- [ ] Define rule IDs and validation.
- [ ] Define rule activation/deactivation.
- [ ] Define conflict detection.
- [ ] Define Constraint Monotonicity.
- [ ] Add schema validation tests.

### Exit criterion

A hard rule can be represented as data and evaluated without hard-coding one special case.

---

## Phase 4 — Runtime Event & Verification Layer

### Goal

Build the evidence layer used by constraints.

### Tasks

- [ ] Define normalized runtime events.
- [ ] Map Harness events into project events.
- [ ] Record tool execution.
- [ ] Record tool results.
- [ ] Record file/code changes where reliably observable.
- [ ] Define verification state.
- [ ] Build reusable verifiers.
- [ ] Distinguish observed facts from LLM claims.
- [ ] Define event/session correlation.

### Exit criterion

Constraint checks operate on structured runtime evidence instead of prompt text.

---

## Phase 5 — Constraint Enforcement Engine

### Goal

Separate policy evaluation from Harness-specific hook code.

### Tasks

- [ ] Implement policy resolution.
- [ ] Implement trigger evaluation.
- [ ] Implement requirement evaluation.
- [ ] Implement `PASS` / `BLOCK` / `REMEDIATE` states.
- [ ] Produce structured block reasons.
- [ ] Produce remediation instructions.
- [ ] Re-check after remediation.
- [ ] Prevent false completion.
- [ ] Add deterministic unit tests.
- [ ] Add Harness integration tests.

### Exit criterion

The engine can handle multiple hard rules consistently.

---

## Phase 6 — Project Policy System

### Goal

Make the first layer a real project-level configuration system.

### Tasks

- [ ] Define project metadata.
- [ ] Define project policy file format.
- [ ] Support project-level hard rules.
- [ ] Support rule enable/disable.
- [ ] Support rule IDs.
- [ ] Support policy versioning.
- [ ] Add policy validation.
- [ ] Add policy diff-friendly formatting.
- [ ] Document how projects should write policies.

### Example

```text
project/
└── .dsh-policy/
    └── policy.json
```

### Exit criterion

A repository maintainer can commit a readable policy file and share it with collaborators.

---

## Phase 7 — Behavior Observation

### Goal

Observe recurring user behavior without changing durable state automatically.

### Pipeline

```text
Runtime Events
      ↓
Observation Engine
      ↓
Candidate Behavior
```

### Tasks

- [ ] Define observation records.
- [ ] Define evidence requirements.
- [ ] Detect repeated patterns.
- [ ] Avoid duplicate candidates.
- [ ] Attach supporting evidence.
- [ ] Assign confidence.
- [ ] Keep observation separate from durable user state.
- [ ] Add deterministic observation tests.

### Exit criterion

The system can say:

> “I observed a recurring pattern.”

without treating it as a confirmed user rule.

---

## Phase 8 — Behavior Guard

### Goal

Convert user-approved observations into useful, non-blocking behavior guidance.

### Tasks

- [ ] Define Behavior Guard schema.
- [ ] Define severity.
- [ ] Define warning conditions.
- [ ] Define message generation.
- [ ] Inject behavior guidance only when relevant.
- [ ] Keep behavior rules below hard project constraints.
- [ ] Add tests showing behavior guidance cannot become an accidental hard gate.

### Exit criterion

A recurring user mistake can produce a contextual warning without falsely becoming a project requirement.

---

## Phase 9 — User Model

### Goal

Create the user-controlled durable personalization layer.

### Main concepts

```text
User Model
├── Behavior Patterns
└── Preferences
```

### Tasks

- [ ] Define durable user model schema.
- [ ] Define preference records.
- [ ] Define behavior-pattern records.
- [ ] Store creation/update timestamps.
- [ ] Store user confirmation state.
- [ ] Support edit.
- [ ] Support delete.
- [ ] Support disable/archive.
- [ ] Prevent autonomous mutation by the Agent.

### Exit criterion

The user can inspect and control everything the system remembers as a durable personalization fact.

---

## Phase 10 — Daily Review / 🧋 Review Center

### Goal

Create the human control point for candidate behavior observations.

### Pipeline

```text
Candidate
   ↓
🧋 Daily Review
   ├── Confirm
   ├── Edit
   └── Ignore / Reject
```

### Tasks

- [ ] Define candidate review record.
- [ ] Show evidence behind each candidate.
- [ ] Confirm candidate.
- [ ] Edit candidate before saving.
- [ ] Reject candidate.
- [ ] Convert confirmed candidate into Behavior Guard/User Model data.
- [ ] Ensure rejection does not silently reappear unchanged.
- [ ] Keep an audit trail where appropriate.

### Exit criterion

The user remains the final authority over long-term behavioral personalization.

---

## Phase 11 — Coding Preference Layer

### Goal

Represent coding style preferences as soft guidance.

### Tasks

- [ ] Define preference schema.
- [ ] Define preference scope.
- [ ] Define preference priority.
- [ ] Resolve relevant preferences for a task.
- [ ] Inject only relevant preferences.
- [ ] Prevent preferences from overriding hard policies.
- [ ] Allow temporary task-specific exceptions where explicitly authorized.

### Exit criterion

The Agent consistently follows user preferences when appropriate without treating style preferences as immutable project laws.

---

## Phase 12 — Context Resolver

### Goal

Avoid dumping the entire user model and all project data into every prompt.

### Principle

> **Resolve only what is relevant to the current task.**

### Example

For a TypeScript API modification, relevant context might be:

```text
Project hard rules:
- tests must pass after code changes
- typecheck must pass

Behavior guidance:
- check affected callers after API changes

Preferences:
- prefer async/await
```

Irrelevant historical information should remain outside the prompt.

### Tasks

- [ ] Define task context.
- [ ] Define rule relevance.
- [ ] Resolve Project Policy.
- [ ] Resolve Behavior Guards.
- [ ] Resolve Preferences.
- [ ] Rank conflicts.
- [ ] Measure context size.
- [ ] Add resolver tests.

### Exit criterion

The Agent sees relevant personalization rather than an uncontrolled memory dump.

---

## Phase 13 — Project & Task Scope

### Goal

Support policy at appropriate scopes.

### Proposed scopes

```text
Global
  ↓
Project
  ↓
Task
```

Specific scopes may add restrictions but must not silently weaken stronger hard requirements.

### Tasks

- [ ] Implement scope resolver.
- [ ] Implement rule inheritance.
- [ ] Implement specificity ordering.
- [ ] Implement conflict resolution.
- [ ] Test monotonicity.

### Exit criterion

Global/project/task rules behave predictably and are explainable.

---

## Phase 14 — Project Lifecycle

### Goal

Make project policies manageable over the whole project lifespan.

### Lifecycle

```text
Create
  ↓
Active
  ↓
Pause
  ↓
Complete
  ↓
Archive
```

### Tasks

- [ ] Create project.
- [ ] Activate project.
- [ ] Pause project.
- [ ] Complete project.
- [ ] Archive project.
- [ ] Disable archived project rules.
- [ ] Preserve useful history.
- [ ] Prevent inactive project rules from leaking into unrelated work.

### Exit criterion

Project rules have a clear lifecycle and no longer become permanent clutter.

---

## Phase 15 — Goal Model

### Goal hierarchy

```text
Long-term Goal
      ↓
Milestone
      ↓
Short-term Goal
      ↓
Today's Task
```

### Important boundary

The system assists with decomposition and execution context; it should not become an autonomous life-management system without explicit user intent.

### Tasks

- [ ] Define goal schema.
- [ ] Define decomposition.
- [ ] Link goals to projects.
- [ ] Link goals to tasks.
- [ ] Resolve goal context when relevant.

### Exit criterion

Goals provide useful project context without overwhelming every Agent turn.

---

## Phase 16 — Full DeepSeek Harness Integration

### Goal

Turn the pieces into one coherent plugin.

### Tasks

- [ ] Register plugin with Harness.
- [ ] Load project policy.
- [ ] Resolve active user/project/task context.
- [ ] Observe runtime events.
- [ ] Enforce hard policies.
- [ ] Inject relevant behavior guidance.
- [ ] Inject relevant preferences.
- [ ] Persist confirmed user model data.
- [ ] Keep all mutation boundaries explicit.

### Exit criterion

A normal DeepSeek Harness session can run with this extension enabled without requiring a separate Agent runtime.

---

## Phase 17 — End-to-End Acceptance Test

### Goal

Prove the entire architecture with realistic scenarios.

### Scenario A — hard project rule

```text
User changes code
→ tests omitted
→ Agent completion blocked
→ Agent runs tests
→ tests pass
→ completion allowed
```

### Scenario B — behavior observation

```text
Repeatedly forgets to check callers
→ observation generated
→ candidate generated
→ user reviews
→ user confirms
→ Behavior Guard becomes durable
```

### Scenario C — preference

```text
User prefers async/await
→ relevant task detected
→ preference injected
→ Agent follows preference
→ preference never blocks legitimate implementation
```

### Scenario D — authority boundary

```text
AI detects recurring mistake
→ AI suggests a new rule
→ user rejects it
→ durable model remains unchanged
```

### Scenario E — scope boundary

```text
Project A policy
→ applies to Project A
→ does not affect Project B
```

---

## Phase 18 — Benchmarks

### Goal

Demonstrate that the project is useful rather than decorative.

### Constraint effectiveness

Measure:

- violation detection rate;
- false-block rate;
- false-pass rate;
- remediation success rate;
- completion correctness.

### Personalization effectiveness

Measure:

- preference adherence;
- behavioral reminder usefulness;
- accepted vs rejected candidates;
- repeated-error reduction.

### Cost

Measure:

- token overhead;
- added latency;
- number of additional LLM calls;
- tool/runtime overhead;
- storage overhead.

An important design target is a **zero-extra-LLM-call MVP** for runtime observation where deterministic/local logic is sufficient.

Optional analysis-LLM calls may be introduced later and should be benchmarked separately.

---

# 10. Open-source strategy

The project is intended to be useful to people beyond the original author.

## GitHub goals

- Public repository from an early stage.
- Clear README.
- Architecture documentation.
- Reproducible examples.
- Small, understandable commits.
- Tests for every important invariant.
- Issues for proposed features.
- Contribution guide.
- Pull requests welcome.

## PR philosophy

Contributors should be able to:

1. understand the architecture;
2. reproduce behavior locally;
3. change one subsystem without understanding the entire repository;
4. prove changes with tests;
5. submit a focused PR.

The maintainer should prefer:

> **small, testable, explainable changes**

over large AI-generated rewrites.

---

# 11. Long-term maintainability principles

### 11.1 Runtime truth beats model claims

When a hard rule can be verified from a tool/result/session event, use that evidence.

### 11.2 Policy and personalization remain separate

Do not mix:

```text
Project Policy
```

with:

```text
User Model
```

The former defines project requirements; the latter describes the user.

### 11.3 Enforcement and explanation remain separate

A model-visible reminder can explain a rule, but the runtime must independently enforce the hard requirement.

### 11.4 Every hard rule should have a test

A rule without a reproducible enforcement test is not a reliable hard rule.

### 11.5 Prefer data-driven rules over hard-coded behavior

The engine should evaluate policy data rather than contain dozens of project-specific `if` statements.

### 11.6 Keep the extension native to Harness

Use Harness's official plugin/event/tool seams rather than forking or patching the core unless upstream architecture genuinely requires it.

### 11.7 Keep user authority explicit

There should always be a clear answer to:

> “Who authorized this durable rule?”

For user-controlled personalization, the answer must ultimately be the user.

---

# 12. Commit strategy

Use small commits that correspond to meaningful architectural steps.

Examples:

```text
chore: initialize dsh policy plugin

docs: document harness extension architecture

feat: add hard policy schema

feat: add constraint evaluator

feat: enforce test requirement after code changes

test: cover hard constraint completion gate

feat: add runtime event normalization

feat: add project policy loader

feat: add behavior observation

feat: add behavior candidates

feat: add daily review workflow

feat: add preference resolver

feat: add context resolver

feat: integrate policy runtime with harness

test: add end-to-end policy scenarios

docs: add amiya integration example
```

Avoid commits such as:

```text
feat: build everything
```

because they make review, debugging, and future PR collaboration much harder.

---

# 13. Initial public milestone definition

Before calling the project "working", the repository should be able to demonstrate this:

```text
┌──────────────────────────────┐
│ User defines project policy  │
│ test required after change  │
└──────────────┬───────────────┘
               ↓
        DeepSeek Harness
               ↓
        Agent edits code
               ↓
        Constraint Engine
               ↓
       no passing test event
               ↓
             BLOCK
               ↓
        Agent runs tests
               ↓
          tests pass
               ↓
             PASS
               ↓
       task can complete
```

This single demonstration establishes the most important distinction of the project:

> **The system is not merely telling the Agent what to do. It is enforcing what the Agent is allowed to finish.**

---

# 14. First implementation checklist

Do these in order and do not jump ahead unnecessarily:

- [ ] Create the GitHub repository.
- [ ] Add `README.md`.
- [ ] Add this project plan.
- [ ] Read and annotate the current DeepSeek Harness extension architecture.
- [ ] Create the smallest plugin skeleton.
- [ ] Define one hard policy: `code_change → tests_pass`.
- [ ] Locate the real enforcement boundary in Harness.
- [ ] Implement the smallest possible Constraint Engine.
- [ ] Write the four POC tests.
- [ ] Demonstrate real BLOCK/PASS behavior.
- [ ] Only after that, begin generalizing the rule system.

---

# 15. Current north-star statement

> **Build a user-controlled runtime layer for DeepSeek Harness where project requirements are hard, user behavioral guidance is contextual, coding preferences are soft, and no AI-generated personalization becomes durable authority without user control.**

The long-term goal is an open-source project that people can actually use, adapt, fork, contribute to, and integrate into their own Agent workflows.

The immediate goal is much smaller:

> **Prove one hard constraint end-to-end.**

Everything else should grow from that proof.
