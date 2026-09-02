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
| Stage 0 | 仓库奠基：脚手架、文档体系、远端仓库、首次提交（Phase 0） | ✅ 完成 | 2026-09-03 | [stage-0](./stages/stage-0-仓库奠基.md) | cf73039 |
| Stage 1 | 环境与 Harness 接入验证：装依赖、最小插件、核实 turn-stopping 阻止机制、产出 architecture.md（Phase 1） | ✅ 完成 | 2026-09-03 | [stage-1](./stages/stage-1-harness接入验证.md) | 见提交记录 |
| Stage 2 | 策略与引擎核心：policy schema/loader/validator、evidence 归一化、constraint-engine 纯函数、单测（Phase 2 前半 + Phase 3/4 雏形） | ✅ 完成 | 2026-09-03 | [stage-2](./stages/stage-2-策略与引擎核心.md) | 见提交记录 |
| Stage 3 | POC 集成测试：adapter 接线，四条测试 A/B/C/D 全绿（Phase 2 exit criterion） | ✅ 完成 | 2026-09-03 | [stage-3](./stages/stage-3-POC集成测试.md) | 见提交记录 |
| Stage 4 | 收尾同步：README、进度更新、剩余工作清单 | ✅ 完成 | 2026-09-03 | [stage-4](./stages/stage-4-收尾同步.md) | 4cc159b |
| Stage 5 | 约束规则模型泛化：两类规则、作用域解析、Constraint Monotonicity、引擎多规则评估（Phase 3/13 雏形） | ✅ 完成 | 2026-09-03 | [stage-5](./stages/stage-5-规则模型泛化.md) | 见提交记录 |
| Stage 6 | 插件 v1：策略驱动 matchers、MUST NOT 门禁（pre-execute deny）、规则注入 prompt（root scope 实测） | ✅ 完成 | 2026-09-03 | [stage-6](./stages/stage-6-MUST-NOT门禁与规则可见性.md) | 见提交记录 |
| Stage 7 | CI（GitHub Actions：typecheck + test）与文档同步 | ✅ 完成 | 2026-09-03 | 本表 | 见提交记录 |

## 里程碑状态

> ✅ **计划书 Phase 2 exit criterion 已达成（2026-09-03）**：集成测试证明 Agent 无法在违反硬项目策略时成功完成任务（Case B 硬拒绝 / Case C 补救后放行），补救路径可解除阻止。`pnpm demo` 可复现。
> ✅ **Phase 3 exit criterion 已达成（2026-09-03）**：硬规则作为数据表示并被引擎泛化评估（多规则独立、作用域单调、停用不强制）。

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
| 2026-09-03 | cf73039 | chore: initialize dsh-policy plugin — Stage 0 仓库奠基 |
| 2026-09-03 | 7643132 | feat: add policy schema, evidence recorder, and constraint engine — Stage 2 核心 |
| 2026-09-03 | 0d82457 | feat: enforce hard policy at the harness turn boundary — Stage 1/3 接入与 POC |
| 2026-09-03 | 4cc159b | docs: harness architecture findings + stage reports — Stage 1/4 文档 |
| 2026-09-03 | （本次） | feat: generalize the constraint rule model (v1) — Stage 5 |
| 2026-09-03 | （本次） | feat: MUST NOT gate + rule-aware prompting (v1) — Stage 6 |
| 2026-09-03 | （本次） | ci + docs sync — Stage 7 |

## 剩余工作（下一轮）

- 证据层完整形态：跨 session 关联、JSONL 持久化、事件/会话相关性（Phase 4 收尾）；
- REMEDIATE 状态显式化与多规则 remediation 合并策略（Phase 5 收尾）；
- .dsh-policy/ 项目策略系统的完整形态（版本、diff 友好格式、编写指南）（Phase 6）；
- 作用域完整实现：global 策略来源（用户级配置）与 task scope（Phase 13）；
- root 注册的 HMR/dispose 管理（architecture.md §8 的取舍）；
- npm 发布前打包（tsdown）与 changesets。

## 硬性流程约定

1. 严格按 `docs/project-plan.md` 实施，不跳步。
2. 每个阶段完成：git commit **并 push 到 GitHub**。
3. 每次提交必须附带阶段报告 md（做了什么/怎么做的/当前进度），并更新本表。
