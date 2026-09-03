# 工程进度总表（PROGRESS）

> 本文件是项目的**阶段划分与进度同步文档**。每个阶段完成后必须更新此表，并在 `docs/stages/` 下留下对应的阶段报告。
> 实施规格以 [project-plan.md](./project-plan.md) 为准（用户原始计划书），本表负责把规格拆成可执行阶段。

## 项目基本信息

- **项目名**：dsh-policy（工作名 DSH Policy & Personalization Runtime）
- **仓库**：https://github.com/x7687315-gif/dsh-policy
- **技术栈**：TypeScript 5 (ESM) / Node ≥ 20 / pnpm / vitest / DeepSeek Harness (`@deepseek-ai/dsh-*` 0.1.1-rc.2 锁定) / Cordis 4.0.2
- **运行环境约束**：本地不做任何模型推理（测试使用 ScriptedAdapter，零 GPU 负载）；LLM 调用一律走 DeepSeek 云端 API。
- **验证基线**：`pnpm test` 117/117 全绿（17 个测试文件）；`pnpm typecheck` 干净；`pnpm build` 产出 dist/index.mjs。

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
| Stage 9 | 全量缺陷审查与修复：补救预算按回合重置、root 注册卸载清理、deny trigger 收紧（+3 回归测试） | ✅ 完成 | 2026-09-03 | [stage-9](./stages/stage-9-缺陷审查与修复.md) | d9584bf |
| Stage 10 | 行为观察引擎：4 类信号、确定性置信度、签名去重、拒绝墓碑、JSONL+原子投影、opt-in（Phase 7 ✅） | ✅ 完成 | 2026-09-03 | [stage-10](./stages/stage-10-行为观察引擎.md) | 3e7d514 |
| Stage 11 | Behavior Guard：双注入通道（prompt 910 + post-execute 附加上下文）、类型隔离非阻塞不变量（Phase 8 ✅） | ✅ 完成 | 2026-09-03 | [stage-11](./stages/stage-11-BehaviorGuard.md) | fd62288 |
| Stage 12 | User Model 单一写路径 + 审计、Review 流水线与 🧋 CLI（交互/管道双模式）、插件只读消费闭环（Phase 9/10 ✅，DSH UI 命令留 Stage 15） | ✅ 完成 | 2026-09-03 | [stage-12](./stages/stage-12-UserModel与Review.md) | c18ae09, b4e3865, 64fb67a |

## 里程碑状态

> ✅ **Phase 2 exit criterion（2026-09-03）**：集成测试证明 Agent 无法在违反硬项目策略时成功完成任务（Case B 硬拒绝 / Case C 补救后放行）。`pnpm demo` 可复现。
> ✅ **Phase 3 exit criterion（2026-09-03）**：硬规则作为数据表示并被引擎泛化评估（多规则独立、作用域单调、停用不强制）。
> ✅ **Phase 4 收尾（2026-09-03）**：证据按会话持久化、进程重启后继续拦截（JSONL 追加写、崩溃容忍）；HMR 安全测试通过；npm 发布形态就绪。
> ✅ **缺陷审查轮（2026-09-03，Stage 9）**：修复三个缺陷（补救预算跨回合不重置、root 注册卸载不清理导致解释/强制分叉、deny 规则省略 trigger 静默失效），各配回归测试钉死。
> ✅ **Roadmap 规划完成（2026-09-03）**：Stage 10-16 详细技术实施方案定稿 → [roadmap.md](./roadmap.md)（数据结构、算法、Harness 集成点、测试策略、风险登记册、计划书条文映射）。各阶段开工前以该文档为技术基线。
> ✅ **Phase 7 行为观察达成（2026-09-03，Stage 10）**：系统能说"I observed a recurring pattern"（跨会话聚合、确定性置信度）且绝不写入用户状态——集成测试含 `user-model.json` 不存在的文件级断言。验证基线升至 **53/53 测试**。
> ✅ **Phase 8 Behavior Guard 达成（2026-09-03，Stage 11）**：非阻塞不变量双向钉死（guard 在场时硬规则照常强制 + guard 永不出现在违规中，类型隔离保证编译期不可能）。验证基线 **58/58 测试**。
> ✅ **Phase 9/10 核心达成（2026-09-03，Stage 12）**：User Model 单一写路径（ConfirmRequest 结构性强制 §11.7）+ 全程审计 + Review 纯函数流水线 + 插件只读消费闭环。验证基线 **65/65 测试**。
> ✅ **L1/L2 架构审计 + 安全加固（2026-09-03）**：审计证明 Behavior Guard / User Model / Preference 均无法绕过授权或获得硬层 BLOCK 权限（类型隔离 + 只读消费 + Preference 未实现）；在此结论上加固硬层自身——passPattern 校验期编译 fail-fast（R1）、回合闸门 fail-closed（R2）。验证基线升至 **69/69 测试（11 文件）**。详见 [stage-audit-L1L2](./stages/stage-audit-L1L2-架构安全审计.md) 与 [stage-fix-R1R2](./stages/stage-fix-R1R2-正则校验与失败闭合.md)。
> ✅ **Phase 11/12 偏好层达成（2026-09-03，Stage 13）**：Context Resolver 纯函数（任务画像 + 三层级 → 最小上下文包）按 roadmap §6.2 落地；token 预算 800 + 层级→priority→recency 淘汰、硬规则永不淘汰；order 920 通道接线、偏好类型隔离不进约束引擎、复用 stage-12 单一写路径产出 preference 记录。验证基线升至 **87/87 测试（14 文件）**。详见 [stage-13](./stages/stage-13-偏好层与ContextResolver.md)。
> ✅ **Phase 13-14 作用域与生命周期达成（2026-09-03，Stage 14）**：global/project/task 三层作用域合并 + 单调性校验期 fail-fast 拒绝弱化（双机制：`resolvePolicies` 保留强者保既有 20 单测，`validateScopeMonotonicity` 校验期拒绝）；项目生命周期 `project-registry.json`（active/pause/complete/archived）+ `dsh-project` CLI（archive 迁移目录、历史保留）；非 active 项目规则不泄漏。验证基线升至 **117/117 测试（17 文件）**。详见 [stage-14](./stages/stage-14-作用域与生命周期.md)。

## 后续阶段（按计划书继续）

> **详细技术方案（数据结构 / 算法 / 集成点 / 测试策略 / 风险）见 [roadmap.md](./roadmap.md)。**

| 阶段 | 目标 | 对应计划书 |
|---|---|---|
| Stage 13 | 偏好层 / Context Resolver（按任务解析相关上下文） | Phase 11-12 | ✅ 完成 | 2026-09-03 | [stage-13](./stages/stage-13-偏好层与ContextResolver.md) | 421937e, 93b7540, 2c1ac56, 88bc938, daf39f1 |
| Stage 14 | 作用域完整实现（global 来源与 task scope）与项目生命周期 | Phase 13-14 | ✅ 完成 | 2026-09-03 | [stage-14](./stages/stage-14-作用域与生命周期.md) | b96d721, 09fc271, b035056 |
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
| 2026-09-03 | d9584bf | fix: per-turn budget, root cleanup, strict deny trigger — Stage 9 |
| 2026-09-03 | 7a6a464 | docs: stage-9 review report + architecture §9 — Stage 9 |
| 2026-09-03 | 84999a3 | docs: roadmap for stages 10-16 — 技术规划 |
| 2026-09-03 | 3e7d514 | feat: behavior observation engine — Stage 10 |
| 2026-09-03 | fd62288 | feat: behavior guard non-blocking guidance — Stage 11 |
| 2026-09-03 | c18ae09 | feat: user model + review pipeline core — Stage 12 |
| 2026-09-03 | b4e3865 | feat: interactive review CLI（交互/管道双模式）— Stage 12 收尾 |
| 2026-09-03 | 64fb67a | fix: handled candidates never re-surface in later review runs |
| 2026-09-03 | 732c9d3 | fix: validate passPattern at load (fail-fast) + fail-closed turn evaluation (R1+R2) |
| 2026-09-03 | 421937e | feat: preference value schema + read-only projection — Stage 13 |
| 2026-09-03 | 93b7540 | feat: context resolver (task profile + relevance + token budget) — Stage 13 |
| 2026-09-03 | 2c1ac56 | feat: plugin wiring order 920 + task-profile tracking — Stage 13 |
| 2026-09-03 | 88bc938 | feat: review pipeline emits preference records — Stage 13 |
| 2026-09-03 | daf39f1 | test: relevance matrix + budget eviction + non-blocking invariant — Stage 13 |
| 2026-09-03 | b96d721 | feat: 作用域完整实现 global/project/task + 单调性校验期拒绝 — Stage 14 |
| 2026-09-03 | 09fc271 | feat: 项目生命周期 registry 与 dsh-project CLI — Stage 14 |
| 2026-09-03 | b035056 | test: 作用域单调性 + 生命周期 + 三层合并集成测试 — Stage 14 |

## 剩余工作（下一轮入口）

- guard taskRegex 通道的多会话隔离（AssembleContext 无会话标识，需 per-session 注入上下文——见 stage-12 报告已知限制）；
- `test_fail_streak` 观察信号实现（需跨事件关联）；
- store 的同步 fs 写入改异步/批量（当前为 MVP 取舍，已在 stage-8 报告记录）；
- npm 发布（打包就绪，待命名/版本策略决定）与 changesets。

## 硬性流程约定

1. 严格按 `docs/project-plan.md` 实施，不跳步。
2. 每个阶段完成：git commit **并 push 到 GitHub**。
3. 每次提交必须附带阶段报告 md（做了什么/怎么做的/当前进度），并更新本表。
