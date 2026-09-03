# Stage 14 作用域完整实现与项目生命周期（Phase 13-14）

- **日期**：2026-09-03
- **关联计划**：`docs/roadmap.md` §7.1–§7.2；`docs/project-plan.md` Phase 13-14；`docs/PROGRESS.md` Stage 14
- **技术基线**：stage-13（Context Resolver、order 900/910/920、类型隔离非阻塞、约束引擎）
- **状态**：✅ 完成（117/117 测试全绿，typecheck 干净；基线 87 → 117，+30 用例，3 个新测试文件）

---

## 与计划的「相同 / 不同」对照（roadmap §7）

> 计划书 §7.1/§7.2 为技术基线。结论：**目标与不变量 100% 对齐，实现路径 4 处按需偏离**，均属安全、可辩护的取舍（超集或双保险），目标模型（§7.3 / Phase 15）明确不在本阶段。

| # | 计划写法（roadmap §7） | 实际落地 | 相同 / 不同 | 偏离理由 |
|---|---|---|---|---|
| 1 | global 来源 `~/.dsh-policy/policy.json` 启动加载 | `loadGlobalPolicy()` 读 `~/.dsh-policy/policy.json`（可选，缺省→`undefined` 不致命）；并支持 `options.globalPolicy` / `options.globalPolicyPath` 内联/指定覆盖 | **不同（超集）** | 内联覆盖让集成测试可确定性传入全局策略而不污染真实用户主目录；默认自动加载行为不变 |
| 2 | 单调性"升级为校验期直接拒绝弱化声明" | 保留 `resolvePolicies` 解析期"保留强者 + 注记"（不破坏 20 条既有单测），**新增独立** `validateScopeMonotonicity` 校验期 fail-fast 拒绝弱化 | **不同（双保险）** | 解析期保留 + 校验期拒绝 = 双保险；既保住既有回归，又满足 §2.5/§7.1"直接拒绝"诉求。两机制职责分离、互不耦合 |
| 3 | task scope 校验器拒绝 task 级 `enabled:false` 同名覆盖 | `validateScopeMonotonicity` 覆盖 global/project/task 任意「较弱作用域对较强作用域」的 `enabled:false` 与"改定义"两类弱化 | **相同（更泛化）** | 不止 task，project→global 同向弱化也一并拒绝，单调性语义一致 |
| 4 | 生命周期 CLI 作为 Stage 12 review CLI 的子命令 `project pause|complete|archive` | 新建**独立** `src/project/cli.ts`（命令 `dsh-project`），暴露 `pause|resume|complete|archive`，并加 `pnpm project` 脚本 | **不同（独立文件 + 多 resume）** | 生命周期与 Review 正交；独立文件边界更清；补 `resume`（active）以便从 pause 复原（计划只列 pause/complete/archive，缺 round-trip） |
| 5 | 归档 = 目录移入 `archive/` + 注册表标记 | `archiveProject(projectId, projectDir, registry, registryPath)` 把 `.dsh-policy` rename 到 `<projectDir>/archive/dsh-policy-<id>-<ts>`，并写注册表 `archivedAt` | **相同** | 历史保留、不可自动发现，与计划一致 |
| 6 | 解析期过滤：非 active 项目规则整组不参与 resolution | `apply()` 装配作用域时：仅当 `isActive(registry, projectId)` 才把 project 文档纳入；否则用空文档兜底（evidence 走默认、规则不泄漏） | **相同** | 非 active（paused/completed/archived）规则不进 resolution；global 仍全局生效（最强作用域不被暂停项目削弱） |
| 7 | 目标模型（§7.3 / Phase 15） | **未做** | — | 明确不在 Stage 14 范围（PROGRESS 表 Stage 14 = Phase 13-14，目标模型归 Stage 15），按计划书边界留 Stage 15 |

**不变量全部达标**（与计划书 §§2.5/7 逐条对照）：
- 单调性：较弱作用域只能新增、不能削弱（校验期拒绝）✅
- 生命周期：非 active 项目规则不泄漏 ✅
- 只读消费：插件只读取 `project-registry.json`，CLI 是唯一写者（与 user-model 边界同手法）✅
- fail-closed：弱化声明让 `apply()` 直接抛错，绝不静默放行 ✅
- 无新增运行期依赖 ✅

---

## 做了什么

1. **`src/policy/schema.ts`**：`RuleScope` 扩展 `'global' | 'project' | 'task'`；新增单一事实来源 `SCOPE_RANK`（global:0 < project:1 < task:2）。
2. **`src/policy/resolver.ts`**：导入 `SCOPE_RANK`，`resolvePolicies` 行为不变；**新增** `validateScopeMonotonicity(policies)` 纯函数（fail-fast 拒绝弱化）+ `MonotonicityResult` 类型。
3. **`src/policy/validator.ts`**：`SCOPES` 加入 `'task'`。
4. **`src/policy/loader.ts`**：新增 `globalPolicyPath()` 与 `loadGlobalPolicy()`（缺省→`undefined`；存在但损坏→抛 `PolicyLoadError`，与项目策略同纪律）。
5. **`src/project/registry.ts`（新）**：`ProjectState`、`ProjectRegistry`、`projectRegistryPath`、`loadRegistry`（缺省/损坏→空，不致命）、`saveRegistry`、`isActive`（未注册=active）、`setProjectState`（不可变、archived 记 `archivedAt`）、`archiveProject`（rename 目录 + 写注册表）。
6. **`src/plugin/index.ts`**：
   - 导入 `loadGlobalPolicy`、`validateScopeMonotonicity`、`isActive` / `loadRegistry` / `projectRegistryPath`、`HardRule` 类型。
   - `DshPolicyOptions` 增 `globalPolicy?`、`globalPolicyPath?`、`taskRules?: HardRule[]`、`projectId?`、`projectRegistryPath?`（各带中文文档说明单调/生命周期语义）。
   - `apply()` 装配 `ScopedPolicy[]`：project（仅当 active）+ global（universal，可选）+ task（additive）；先 `validateScopeMonotonicity`（失败抛错 fail-fast），再 `resolvePolicies`。900/910/920 通道零改动。
7. **`src/project/cli.ts`（新）**：`dsh-project <pause|resume|complete|archive> <id> [--dir --registry]`，CLI 是唯一写者。
8. **`package.json`**：加 `project` 脚本。

---

## 怎么做的

- **双机制单调性**：`resolvePolicies`（保留 + 注记，非致命，保既有 20 单测）与 `validateScopeMonotonicity`（fail-fast 拒绝）分离，互不耦合，满足 §2.5/§7.1。
- **生命周期只读边界**：插件只 `loadRegistry` + `isActive`，CLI 是唯一 `saveRegistry` / `archiveProject` 写者，复用 user-model 边界手法。
- **非 active 兜底**：用空 `PolicyDocument` 替代被排除的 project 文档，保证下游 evidence 配置走默认、规则文本零泄漏。
- **测试（+30，3 文件）**：
  - `tests/unit/scope-monotonicity.test.ts`（+8）：纯函数矩阵（增/删/改、跨作用域、禁用较强规则不挡、多违例全报）。
  - `tests/unit/project-registry.test.ts`（+15）：加载（缺省/损坏/形状）、`isActive` 各态、状态迁移不可变、归档移动目录、路径。
  - `tests/integration/scope-lifecycle.test.ts`（+7）：真实 Harness 集成——三层合并入 prompt、弱化声明让 `buildStack` 抛错、paused 项目规则不出现、archived 不影响 turn-stopping、active 对照仍 BLOCK。
- **验证**：`pnpm typecheck` 干净；`pnpm test` **117/117 全绿**（17 文件）。无回归。

---

## 还有没有做的（诚实登记，未做的不编造）

- **目标模型（GoalNode，§7.3 / Phase 15）**：明确不在 Stage 14 范围，留 Stage 15。
- **生命周期 DSH UI 命令集成**：计划本身说官方 UI 命令 API 不稳定、放 Stage 15 并允许降级；本阶段仅 CLI。
- **Scenario E（双 stack 双策略 无串扰）端到端**：属 Stage 15 真实组合测试（cordis.yml loader）。本阶段以「三层合并 + 生命周期过滤 + 单调性拒绝」的集成/单测覆盖机制本身；Scenario E 全量验收留 Stage 15。
- **`apply()` 作用域装配块可进一步抽成纯函数 `assembleScopes(options)`**：当前已由集成测试覆盖，债轻微（见质量报告）。

---

## 退出标准对照

| 计划书要求 | 状态 |
|---|---|
| global/project/task 规则可预测（合并 + 单调性） | ✅ |
| 单调性有测试（三层 × 增/删/改） | ✅ |
| 归档项目规则不泄漏（prompt 无其文本 + turn-stopping 不评估） | ✅ |
| 生命周期 CLI 命令 | ✅ |
| 无新增运行期依赖 | ✅ |
| 回归基线不破（87 → 117） | ✅ |
| 目标模型（属 Stage 15） | ➖ 不在本阶段 |

---

## 代码质量报告（@skill:code-check，四维度）

| 维度 | 状态 | 摘要 |
|------|------|------|
| 模块化 | ✓ Pass | registry（生命周期状态 + 归档移动）单职责；resolver 纯函数；plugin 仅装配；CLI 独立。无 god-file。 |
| 可维护性 | ✓ Pass | 命名直白；关键偏离与边界均有注释；关键路径有可运行测试；无重复逻辑（`saveRegistry` / 路径默认集中复用）。 |
| 架构符合 | ✓ Pass | 900/910/920 零改动；插件只读消费 registry、CLI 唯一写者（与 user-model 边界一致）；依赖向下无环；单调性 fail-fast 在 resolve 前。 |
| 技术债 | △ Warn | 轻微债 1 处：`apply()` 作用域装配块可抽 `assembleScopes` 纯函数以利单测（当前集成测试已覆盖，非缺陷）。无 FIXME/HACK/TODO，无禁用检查，无硬编码 secret，无破坏分层。 |

**关键违例（需阻塞修复）**：无。
**门禁决定**：✅ 通过，继续。

---

## 工程进度

- 下一轮：Stage 15 全量 Harness 集成与端到端验收（含目标模型 GoalNode §7.3、Scenario A-E、cordis.yml 真实组合测试）。
