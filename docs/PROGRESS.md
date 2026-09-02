# 工程进度总表（PROGRESS）

> 本文件是项目的**阶段划分与进度同步文档**。每个阶段完成后必须更新此表，并在 `docs/stages/` 下留下对应的阶段报告。
> 实施规格以 [project-plan.md](./project-plan.md) 为准（用户原始计划书），本表负责把规格拆成可执行阶段。

## 项目基本信息

- **项目名**：dsh-policy（工作名 DSH Policy & Personalization Runtime）
- **仓库**：https://github.com/x7687315-gif/dsh-policy
- **技术栈**：TypeScript 5 (ESM) / Node ≥ 20 / pnpm / vitest / DeepSeek Harness (`@deepseek-ai/dsh-*` 0.1.1-rc.2 锁定) / Cordis 4.0.2
- **运行环境约束**：本地不做任何模型推理（测试使用 ScriptedAdapter，零 GPU 负载）；LLM 调用一律走 DeepSeek 云端 API。
- **验证基线**：`pnpm test` 36/36 全绿（6 个测试文件）；`pnpm typecheck` 干净；`pnpm build` 产出 dist/index.mjs。

## 阶段总表

| 阶段 | 目标（对应计划书 Phase） | 状态 | 完成日期 | 阶段报告 | 关键 commit |
|---|---|---|---|---|---|
| Stage 0 | 仓库奠基：脚手架、文档体系、远端仓库、首次提交（Phase 0） | ✅ 完成 | 2026-09-03 | [stage-0](./stages/stage-0-仓库奠基.md) | cf73039 |
| Stage 1 | 环境与 Harness 接入验证：装依赖、最小插件、核实 turn-stopping 阻止机制、产出 architecture.md（Phase 1） | ✅ 完成 | 2026-09-03 | [stage-1](./stages/stage-1-harness接入验证.md) | 0d82457 |
| Stage 2 | 策略与引擎核心：schema/loader/validator、evidence 归一化、纯函数引擎、单测 | ✅ 完成 | 2026-09-03 | [stage-2](./stages/stage-2-策略与引擎核心.md) | 7643132 |
| Stage 3 | POC 集成测试：adapter 接线，四条测试 A/B/C/D 全绿（Phase 2 exit criterion ✅） | ✅ 完成 | 2026-09-03 | [stage-3](./stages/stage-3-POC集成测试.md) | 0d82457 |
| Stage 4 | 收尾同步：README、进度更新 | ✅ 完成 | 2026-09-03 | [stage-4](./stages/stage-4-收尾同步.md) | 4cc159b |
| Stage 5 | 约束规则模型泛化：两类规则、作用域解析、Constraint Monotonicity（Phase 3 ✅） | ✅ 完成 | 2026-09-03 | [stage-5](./stages/stage-5-规则模型泛化.md) | f32ee0d |
| Stage 6 | 插件 v1：策略驱动 matchers、MUST NOT 门禁（pre-execute deny）、规则注入 prompt | ✅ 完成 | 2026-09-03 | [stage-6](./stages/stage-6-MUST-NOT门禁与规则可见性.md) | f32ee0d |
| Stage 7 | CI（GitHub Actions）与文档同步 | ✅ 完成 | 2026-09-03 | 本表 | 6c84051 |
| Stage 8 | 证据 JSONL 持久化（按会话键控、重启不失忆）、HMR 安全测试、tsdown 发布形态、策略编写指南（Phase 4 收尾 ✅） | ✅ 完成 | 2026-09-03 | [stage-8](./stages/stage-8-持久化与HMR安全.md) | 1a478ab |
| Stage 9 | 全量缺陷审查与修复：补救预算按回合重置、root 注册卸载清理、deny trigger 收紧（+3 回归测试） | ✅ 完成 | 2026-09-03 | [stage-9](./stages/stage-9-缺陷审查与修复.md) | 见提交记录 |

## 里程碑状态

> ✅ **Phase 2 exit criterion（2026-09-03）**：集成测试证明 Agent 无法在违反硬项目策略时成功完成任务（Case B 硬拒绝 / Case C 补救后放行）。`pnpm demo` 可复现。
> ✅ **Phase 3 exit criterion（2026-09-03）**：硬规则作为数据表示并被引擎泛化评估（多规则独立、作用域单调、停用不强制）。
> ✅ **Phase 4 收尾（2026-09-03）**：证据按会话持久化、进程重启后继续拦截（JSONL 追加写、崩溃容忍）；HMR 安全测试通过；npm 发布形态就绪。
> ✅ **缺陷审查轮（2026-09-03，Stage 9）**：修复三个缺陷（补救预算跨回合不重置、root 注册卸载不清理导致解释/强制分叉、deny 规则省略 trigger 静默失效），各配回归测试钉死。

## 后续阶段（按计划书继续）

| 阶段 | 目标 | 对应计划书 |
|---|---|---|
| Stage 10 | 行为观察引擎（零额外 LLM 调用的确定性观察器、candidate、证据与置信度） | Phase 7 |
| Stage 11 | Behavior Guard（用户确认后的非阻塞行为引导） | Phase 8 |
| Stage 12 | User Model（用户可控的持久个性化层）与 🧋 Daily Review | Phase 9-10 |
| Stage 13 | 偏好层 / Context Resolver（按任务解析相关上下文） | Phase 11-12 |
| Stage 14 | 作用域完整实现（global 来源与 task scope）与项目生命周期 | Phase 13-14 |
| Stage 15 | 全量 Harness 集成与端到端验收（场景 A-E） | Phase 16-17 |
| Stage 16 | 基准测试（约束有效性 / 个性化有效性 / 成本） | Phase 18 |

## 提交记录

| 日期 | commit | 说明 |
|---|---|---|
| 2026-09-03 | cf73039 | chore: initialize dsh-policy plugin — Stage 0 |
| 2026-09-03 | 7643132 | feat: policy schema, evidence recorder, constraint engine — Stage 2 |
| 2026-09-03 | 0d82457 | feat: enforce hard policy at the turn boundary — Stage 1/3 |
| 2026-09-03 | 4cc159b | docs: architecture findings + stage reports — Stage 4 |
| 2026-09-03 | f32ee0d | feat: generalize constraint rule model + MUST NOT gate (v1) — Stage 5/6 |
| 2026-09-03 | 6c84051 | ci: typecheck + tests on push/PR — Stage 7 |
| 2026-09-03 | 709baf8 | docs: stages 5-7 sync — Stage 7 |
| 2026-09-03 | 1a478ab | feat: durable evidence, HMR safety, policy guide — Stage 8 |
| 2026-09-03 | 0ba14eb | build: tsdown bundle — Stage 8 |
| 2026-09-03 | 4f9c279 | docs: stage 8 sync — Stage 8 |
| 2026-09-03 | （本次） | fix: per-turn budget, root cleanup, strict deny trigger — Stage 9 |
| 2026-09-03 | （本次） | docs: stage 9 review report + architecture §9 — Stage 9 |

## 剩余工作（下一轮入口）

- Stage 10 行为观察引擎（Phase 7）：观察记录 schema、重复模式检测、去重、置信度——观察与持久用户状态严格分离；
- REMEDIATE 状态显式化与多规则 remediation 合并（Phase 5 收尾）；
- global 作用域策略来源（用户级配置文件）与 task scope（Phase 13）；
- store 的同步 fs 写入改异步/批量（当前为 MVP 取舍，已在 stage-8 报告记录）；
- npm 发布（打包就绪，待命名/版本策略决定）与 changesets。

## 硬性流程约定

1. 严格按 `docs/project-plan.md` 实施，不跳步。
2. 每个阶段完成：git commit **并 push 到 GitHub**。
3. 每次提交必须附带阶段报告 md（做了什么/怎么做的/当前进度），并更新本表。
