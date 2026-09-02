# 工程进度总表（PROGRESS）

> 本文件是项目的**阶段划分与进度同步文档**。每个阶段完成后必须更新此表，并在 `docs/stages/` 下留下对应的阶段报告。
> 实施规格以 [project-plan.md](./project-plan.md) 为准（用户原始计划书），本表负责把规格拆成可执行阶段。

## 项目基本信息

- **项目名**：dsh-policy（工作名 DSH Policy & Personalization Runtime）
- **仓库**：https://github.com/x7687315-gif/dsh-policy
- **技术栈**：TypeScript 5 (ESM) / Node ≥ 20 / pnpm / vitest / DeepSeek Harness (`@deepseek-ai/dsh-*`) / Cordis
- **运行环境约束**：本地不做任何模型推理（测试使用 MockAdapter，零 GPU 负载）；LLM 调用一律走 DeepSeek 云端 API。

## 阶段总表

| 阶段 | 目标（对应计划书 Phase） | 状态 | 完成日期 | 阶段报告 | 关键 commit |
|---|---|---|---|---|---|
| Stage 0 | 仓库奠基：脚手架、文档体系、远端仓库、首次提交（Phase 0） | ✅ 完成 | 2026-09-03 | [stage-0](./stages/stage-0-仓库奠基.md) | 见下方提交记录 |
| Stage 1 | 环境与 Harness 接入验证：装依赖、最小插件、核实 turn-stopping 阻止机制、产出 architecture.md（Phase 1） | ⬜ 未开始 | — | — | — |
| Stage 2 | 策略与引擎核心：policy schema/loader/validator、evidence 归一化、constraint-engine 纯函数、单测（Phase 2 前半 + Phase 3/4 雏形） | ⬜ 未开始 | — | — | — |
| Stage 3 | POC 集成测试：adapter 接线，四条测试 A/B/C/D 全绿（Phase 2 exit criterion） | ⬜ 未开始 | — | — | — |
| Stage 4 | 收尾同步：README、进度更新、剩余工作清单 | ⬜ 未开始 | — | — | — |

## 后续阶段（本轮 1 小时之外，按计划书继续）

| 阶段 | 目标 | 对应计划书 |
|---|---|---|
| Stage 5+ | 约束规则模型泛化（Rule/RuleScope/触发器/需求模型/冲突检测/单调性） | Phase 3 |
| Stage 6+ | 运行时事件与验证层完善 | Phase 4 |
| Stage 7+ | 约束执行引擎泛化（多规则、REMEDIATE 状态） | Phase 5 |
| Stage 8+ | 项目策略系统（.dsh-policy/policy.json 完整形态） | Phase 6 |
| Stage 9+ | 行为观察 / Behavior Guard / User Model / Daily Review | Phase 7-10 |
| Stage 10+ | 偏好层 / Context Resolver / 作用域与生命周期 | Phase 11-14 |
| Stage 11+ | 全量 Harness 集成与端到端验收 | Phase 16-17 |
| Stage 12+ | 基准测试 | Phase 18 |

## 提交记录

| 日期 | commit | 说明 |
|---|---|---|
| 2026-09-03 | （本次） | chore: initialize dsh-policy plugin — Stage 0 仓库奠基 |

## 硬性流程约定

1. 严格按 `docs/project-plan.md` 实施，不跳步。
2. 每个阶段完成：git commit **并 push 到 GitHub**。
3. 每次提交必须附带阶段报告 md（做了什么/怎么做的/当前进度），并更新本表。
