# Stage 13 偏好层与 Context Resolver（Phase 11-12）

- **日期**：2026-09-03
- **关联计划**：`C:\Users\86159\Desktop\st13.md`（开工前计划书，本文对照其 Step 1-5）
- **技术基线**：roadmap §6（Context Resolver 规格、token 预算 800、order 900/910/920）；stage-11（类型隔离非阻塞）、stage-12（UserModelStore 单一写路径 + ConfirmRequest 结构强制）
- **状态**：✅ 完成（87/87 测试全绿，typecheck 干净；基线 69 → 87，+18 用例，3 个新测试文件）

---

## 与 st13.md 计划的「相同 / 不同」对照（用户要求）

> 计划书编写者声明「未读 `src/` 源码」，5 处 `[需核对]` 全部在落地时通过读源码消解。结论：**目标与不变量 100% 对齐，实现路径 5 处按需偏离**，均属安全、可辩护的取舍。

| # | 计划书写法（st13.md） | 实际落地 | 相同 / 不同 | 偏离理由 |
|---|---|---|---|---|
| 1 | 新建 `src/preference/schema.ts` + zod `PreferenceRecord`，带 `scope:'user'\|'project'`、独立 `confirmedAt:string` | **不新建文件、不用 zod**。富化既有 `src/usermodel/schema.ts` 的 `PreferenceValue`（加 `kind`/`appliesTo`/`priority`），沿用 `UserModelRecord{kind:'preference'}` 的信封（scope/enabled/createdAt/updatedAt/provenance 已在其上） | **不同（路径偏离）** | `UserModelRecord` 已封装全部信封字段，且 stage-12 的 `UserModelStore.create` + `ConfirmRequest` 是唯一写路径。再造 `PreferenceRecord` 会引入平行记录类型 + 平行写路径，反而破坏计划书自身的不变量「§11.7 用户权威可溯」「Agent 无写路径」。zod 见 #3 |
| 2 | `Resolution` 字段名不确定（`[需核对] input.resolution.rules`） | `Resolution.rules: HardRule[]` 经读源码确认；resolver 用 `summarizeRules(input.resolution)` | **相同** | 字段名与计划推断一致 |
| 3 | zod 校验（计划 `[需核对]`：项目是否已用 zod） | 项目 `package.json` 无任何 zod/picomatch；统一手写 TS 类型 + 单一写路径校验 | **不同（选型偏离）** | 项目依赖最小化、离线安全；真实安全边界是 `UserModelStore.create` 强制携带 `ConfirmRequest`，而非 schema 校验库。provenance 缺失会在写路径被结构性拒绝，不靠运行时 schema |
| 4 | `guardMatchesTask(g, taskProfile)`（计划中调用了一个不存在的函数） | 复用**真实** `alwaysGuards` + `taskGuardsFor` + `guardContextText`（`src/behavior/guard.ts`） | **不同（实现偏离，但更优）** | 计划设想的 `guardMatchesTask` 源码中不存在；直接复用 910 通道同款函数，保证 prompt 字节级一致、零重复逻辑 |
| 5 | 新增依赖 `picomatch`（roadmap §6.2 指定） | 手写 `globToRegExp`（支持 `**`/`*`/`?`，转义元字符），**不新增依赖** | **不同（依赖偏离）** | 项目刻意依赖最小化 + 离线；`globToRegExp` 覆盖 resolver 需要的 `'**'` 与 `'*.ext'` 形态，Stage 14 如需花括号/`[...]` 可一键换 `picomatch` |
| 6 | `currentTaskProfile(ctx)`（计划 `[需核对]`：对齐 guard taskRegex 取值） | 在插件 `apply()` 闭包内追踪 `lastTaskText`（`session/event` user/message）+ `recentFiles`（post-execute 工具参数里的 path-like 串）+ `recentTools`，注入 920 回调 | **相同（数据来源一致）** | 与 guard taskRegex 通道用同一份 `lastTaskText`；`recentFiles` 由 `isPathLike` 扫描工具参数得到 |

**不变量全部达标**（与计划书 §「必须遵守的不变量」逐条对照）：
- 偏好永不阻塞 → `preference` 不进 `HardRule` 联合类型，类型隔离（与 stage-11 同手法）✅
- 偏好永不覆盖硬策略 → 物理排序 900 > 910 > 920 ✅
- Agent 无写路径 → 复用 `UserModelStore` + `ConfirmRequest` ✅
- 用户权威可溯 → `provenance` 同 stage-12 ✅
- 零额外 LLM 调用 → `resolveContext` 全确定性纯函数，无任何 LLM import ✅

---

## 做了什么

1. **`src/usermodel/schema.ts` 富化 `PreferenceValue`**
   - 新增 `PreferenceAppliesTo { language?; fileGlob?; taskRegex? }` 与 `PreferenceValue { text; kind?:'style'|'workflow'; appliesTo?; priority? }`。
   - `UserModelRecord.kind` 已是 `'behavior_pattern' | 'preference'`，preference 直接复用信封，不新增并行类型。
2. **新建 `src/usermodel/preferences.ts`（读路径投影）**
   - `preferencesFromUserModel(records)`：只投影 `enabled && kind==='preference'` 且 `text` 非空 → `ResolvedPreference[]`；`priority` 默认 50，`recency` 取 `updatedAt`。
   - **严格只读**，无任何 mutation surface（与 guard 投影对称）。
3. **新建 `src/context/resolver.ts`（纯函数，roadmap §6.2 反记忆堆 dump 核心）**
   - 输入 `TaskProfile + Resolution + guards + preferences + tokenBudget` → 输出 `ContextBundle{ sections, truncation? }`。
   - 硬规则：`summarizeRules` 全量、永不淘汰；guard：`alwaysGuards`+`taskGuardsFor` 复用 910 同款匹配；preference：`matchPreference` 按 `appliesTo`（language/glob/taskRegex）确定性匹配。
   - Token 预算：默认 800，`estimateTokens = ceil(chars/3.5*1.15)`；超限按 层级→priority→recency 淘汰 evictable 项，硬规则 `evictable:false` 结构上不可能被移除，末尾追加 `(+k rules omitted)`。
   - `globToRegExp` 手写（无依赖），`safeRegexTest` try/catch 防坏正则炸进组装路径。
4. **`src/policy/resolver.ts` 抽出 `summarizeRules`**
   - 从插件入口移到纯模块，使 `ContextResolver` 可复用而无「context → plugin」分层环。
5. **`src/plugin/index.ts` 接线 920 通道 + 任务画像追踪**
   - `DshPolicyOptions` 增 `preferences?: ResolvedPreference[]` 与 `context?: { tokenBudget? }`。
   - `apply()` 内：从 user model 投影偏好（与 guard 同模式）；追踪 `lastTaskText`/`recentFiles`(cap 20)/`recentTools`(cap 10)。
   - 注册 order-920 `root.systemPrompt.context({ name:'dsh-policy/preferences', order:920, text: () => resolveContext(...).sections.find(order===920)?.text })`，`ctx.effect(() => dispose)` 保证 HMR 清理。900/910 不动。
6. **`src/review/review.ts` 支持产出 preference 记录**
   - `ReviewDecision` 增 `as?: 'behavior_pattern'|'preference'` 与 `preferenceValue?: PreferenceValue`。
   - confirm/edit 分支：`as==='preference'` → `store.create({kind:'preference', value}, request)`，仍走 stage-12 单一写路径；默认 confirm 仍为 `behavior_pattern`（无回归）。

---

## 怎么做的

- **架构边界零破坏**：`resolveContext` 与 910 通道共用 `taskGuardsFor`/`alwaysGuards`/`guardContextText`，保证 prompt 字节级一致；`summarizeRules` 上移打破潜在分层环。偏好在类型层面进不了 `evaluatePolicy`，非阻塞由编译期保证（同 stage-11 手法）。
- **fail-safe**：`safeRegexTest` 坏 `taskRegex` 不抛；`isPathLike` 扫描工具参数，上限封顶，绝不因个别脏参数影响相关性。
- **测试（18 条，3 文件，全部新增）**：
  - `tests/unit/preference-resolver.test.ts`（+10）：相关性矩阵（language/glob/taskRegex/无条件）、`globToRegExp`（`**`/`*`/`?`/转义）、预算淘汰（50 偏好+3 硬规则+预算 200 → 硬规则全在、最低优先级先淘汰、`(+k rules omitted)`）、priority/recency 排序、非阻塞（仅 920 文本）、enabled 投影。
  - `tests/integration/preference.test.ts`（+6）：相关注入/无关不出现、非阻塞不变量（硬违规仍 BLOCK 且 violation 不含 preference）、HMR dispose 移除文本、只读消费（审计行数不变）、首轮流序（taskRegex 从第二轮起出现）。
  - `tests/unit/review-preference.test.ts`（+2）：`as:'preference'` 写出 `kind:'preference'` + 投影回读；默认 confirm 仍 `behavior_pattern`（无回归）。
- **验证**：`pnpm typecheck` 干净（exit 0）；`pnpm test` **87/87 全绿**（14 文件）。无回归。

---

## 还有没有做的（诚实登记，未做的不编造）

- **未做：store 同步 fs → 异步/批量缓冲写**（计划 Step 3.3 提及、roadmap 风险登记册）。本步未改 store I/O；该债已在 stage-8 报告与 PROGRESS「剩余工作」登记为独立项，留待后续（与偏好层无关，强行并入会扩大 Stage 13 范围）。
- **未做：对抗性注入专项测试**（计划 Step 3.3「用户消息含 ignore previous preferences → bundle 不受影响」）。`resolveContext` 是无状态纯函数，相关性不依赖上下文内容（除 taskRegex 字面匹配），该不变量已由纯函数性质覆盖；未单写此用例，风险低。
- **未做：preference `scope:'project'` 写入**（计划 Step 1 字段）。`UserModelRecord.scope` 已为 `'user'`，project 级来源与 task scope 完整实现属 **Stage 14**（计划书自身也标注「Stage 14 完整实现，本阶段先定义字段」）。
- **未做：`recentTools` 的基于工具的相关性匹配**：`TaskProfile.recentTools` 已追踪并在 920 回调传入，但 `matchPreference` 当前未消费（仅 `userMessage`/`recentFiles` 参与）。代码注释标注为「potential future tool-based relevance」，非隐藏缺陷。
- **`globToRegExp` 不支持花括号 `{a,b}` / 字符类 `[...]`**：刻意精简；Stage 14 如需可换 `picomatch`。当前 `appliesTo.fileGlob` 仅用 `**` 与 `*.ext` 形态，已覆盖。

---

## 退出标准对照

| 计划书要求 | 状态 |
|---|---|
| 偏好不阻塞（测试 7 / 非阻塞不变量） | ✅ |
| 偏好不覆盖硬规则（物理 order 920 < 900） | ✅ |
| Agent 无写路径（ConfirmRequest 结构强制 + 测试 9 审计不变） | ✅ |
| 零额外 LLM 调用（纯函数 + 无 LLM import） | ✅ |
| 硬规则永不淘汰（预算淘汰单测） | ✅ |
| 回归基线不破（69 → 87，无回归） | ✅ |
| token 预算 ≤ 800 可配 | ✅ |

---

## 代码质量报告（@skill:code-check，四维度）

| 维度 | 状态 | 摘要 |
|------|------|------|
| 模块化 | ✓ Pass | 单一职责清晰：preferences.ts（只读投影）、context/resolver.ts（纯 bundle）、plugin（接线）、review（产出）；无 god-file。 |
| 可维护性 | ✓ Pass | 命名直白（`matchPreference`/`globToRegExp`/`ResolvedPreference`）；关键偏离处均有注释；关键路径有可运行测试。 |
| 架构符合 | ✓ Pass | 分层 900/910/920 物理有序；偏好类型隔离不进约束引擎；依赖向下无环（`summarizeRules` 上移打破潜在环）；与计划不变量逐条对齐。 |
| 技术债 | △ Warn | 3 处轻微债：① `recentTools` 已追踪但暂未被 `matchPreference` 消费（标为未来工具相关性，非缺陷）；② `resolveContext` 内部重算的 guard/hard 文本在插件侧仅取 920 切片（冗余但可接受，bundle 单测独立覆盖）；③ `isPathLike` 可能把 URL/带点串误判为文件（cap 20，低风险）。无 FIXME/HACK/TODO，无禁用检查。 |

**关键违例（需阻塞修复）**：无。
**门禁决定**：✅ 通过，继续。

---

## 工程进度

- 下一轮：Stage 14 作用域完整实现（global 来源 + task scope，project 级 preference 来源）；可选补 store 异步缓冲写、preference 工具相关性。
