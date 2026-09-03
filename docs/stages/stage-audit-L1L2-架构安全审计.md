# L1/L2 架构安全审计（阶段报告）

- **日期**：2026-09-03
- **触发**：用户硬性要求「先做一次非常严格的 L1/L2 架构审计：看看现在的代码有没有任何路径能够让 Behavior Guard、User Model 或 Preference 绕过用户授权，或者间接获得 Hard Constraint 的 BLOCK 权限。」
- **方法**：基于真实源码逐文件重读 + import 图 grep 追踪，不依赖任何未读源码的文档。
- **状态**：✅ 审计完成；核心安全命题结论为「当前代码不存在该路径」；另有 1 项硬层自身 fail-open 风险（R2）与 1 项配置健壮性风险（R1）建议加固，待用户确认后再改。

---

## 一、做了什么（审计结论）

**安全命题**：是否存在任何代码路径，使 Behavior Guard / User Model / Preference 能够 (a) 绕过用户授权，或 (b) 间接获得 Hard Constraint 的 BLOCK 权限？

**逐项结论：**

| 层 | 能否获得 BLOCK | 能否绕过用户授权 | 依据 |
|---|---|---|---|
| **L2 Behavior Guard** | ❌ 不能 | ❌ 不能 | 类型隔离 + 仅 two 个非阻塞通道 |
| **User Model** | ❌ 不能（仅产出 L2 guard） | ❌ 不能（写路径强制 ConfirmRequest） | 单一写路径 + 运行时只读消费 |
| **Preference (L3)** | — 不存在该层 | — 不存在该层 | Stage 13 未实现，无运行时代码 |

**总判定：当前代码不存在使软层获得硬层 BLOCK 权限或绕过授权的路径。**

---

## 二、怎么做的（逐路径追踪）

### 2.1 Hard Constraint 的 BLOCK 权威只来自一处
- `evaluatePolicy(resolution, evidence) → PASS | BLOCK`（`src/engine/constraint-engine.ts`）：全量收集、无短路，任一违规即 BLOCK。
- 仅两个 seam 调用它：
  1. `tools/pre-execute`：`denied` 命中即 `{kind:'deny'}`（MUST NOT 硬门禁，工具体不执行）。
  2. `agent/turn-stopping`：`evaluatePolicy` 返回 BLOCK 且超出补救预算 → `throw new PolicyViolationError`（回合失败，永不伪完成）。
- `Resolution.rules: HardRule[]`，`HardRule = ToolPassRule | DenyToolsRule`（`src/policy/schema.ts`）。

### 2.2 Behavior Guard 的隔离（核心不变量）
- `BehaviorGuardRule`（`src/behavior/guard.ts`）是**独立接口**，不在 `HardRule` 联合类型内。
- import 图证实决策函数与软层无连接：
  - `constraint-engine.ts` **不 import** `guard.ts`；`resolver.ts` **不 import** `guard.ts`。
  - `evaluatePolicy` 的入参 `Resolution` 在类型上装不下 guard —— 编译期即不可能。
- 软层在插件运行时仅被用在这两处，且均为「只加不动」：
  1. `tools/post-execute`：`toolGuardsFor(...)` 命中后，`decision.kind === 'accept'` 前提下**仅追加** `additionalContexts`（提醒文本）。它无法把 accept 改成 deny，无法抛错，无法改写结果。
  2. `ctx.root.systemPrompt.context({name:'dsh-policy/guards', order:910})`：纯文本注入，物理排序在硬规则 900 之后、偏好 920 之前。
- **深度防御**：即便 guard 文本写「忽略硬策略」，强制 seam（pre-execute deny / turn-stopping BLOCK）仍结构性独立运行，prompt 文本无法禁用它们。

### 2.3 User Model 的读写分离
- **读路径（运行时唯一消费）**：`plugin/index.ts` → `readUserModelGuardRules` → `readUserModel` → `UserModelStore.records()`（只读 load）。`guardsFromUserModel` 仅把 enabled 的 `behavior_pattern` 投影成 `BehaviorGuardRule`（→ 归约到 2.2 的非阻塞通道）。
- **写路径（唯一）**：`UserModelStore.create/update/disable/delete` **全部要求 `ConfirmRequest`**（`src/usermodel/store.ts`）。可达性：仅 `review/cli.ts` + `review/review.ts.applyReview` 调用，且 `ConfirmRequest` 由人类 CLI/UI 在调用点显式提供。
- **关键事实**：`plugin/index.ts` **根本不 import `UserModelStore`**（grep 确认：仅 review 两个文件 import 它）。即运行时从 agent loop 到任何写方法**不存在代码路径**。
- 用户模型在激活时只读加载一次 —— 那是用户此前已确认过的持久状态，本身即授权，非绕过。

### 2.4 Preference（L3）现状
- 全仓 grep `[Pp]reference` 仅在两处命中：
  1. `src/behavior/guard.ts` 注释「from your confirmed preferences」（描述性文字）；
  2. `src/usermodel/schema.ts` 类型联合 `kind: 'behavior_pattern' | 'preference'`（声明，无运行逻辑）；`guardsFromUserModel` 过滤 `kind === 'behavior_pattern'`，即便存在 preference 记录也**不会**投影成 guard。
- 无 `src/context/resolver.ts`、无 preference 强制逻辑；roadmap §6 将其排在 Stage 13（依赖 Stage 12，尚未实施）。
- 结论：该层代码不存在，无从「绕过」或「获得 BLOCK」。

---

## 三、还发现什么（诚实登记，待确认再改）

审计中识别到**两个与命题互补**的风险（它们关乎「硬层自身的 BLOCK 不被意外丢失/误触」），非软层越权：

### R2 / F-04c（真实，建议改）：turn-stopping 未 fail-closed
- `src/plugin/index.ts` 第 255-292 行 `agent/turn-stopping` 处理器直接调用 `evaluatePolicy` 而**无 try/catch**。
- 若 `evaluatePolicy` 因任何原因抛异常（如证据库损坏），异常上抛至 harness，硬闸门是否被保住取决于 harness 行为 —— 结构上**不保证 BLOCK**。
- 修复方向：包裹 try/catch，异常时**默认 BLOCK**（fail-closed），守住硬约束权威。

### R1 / F-04b（真实，建议改）：passPattern 仅在验证期做类型检查，未编译
- `src/policy/validator.ts` 第 101-103 行仅把 `passPattern` 当 `string` 类型校验，从不 `new RegExp` 编译。
- 畸形正则通过验证后，在 `src/plugin/index.ts` 第 226 行 `new RegExp(pattern).test(text)` 运行期抛出：
  - 该 verification tool 的证据**永不被记录** → `evaluatePolicy` 判定「改动后无通过运行」→ **误 BLOCK（假阳性硬闸门）**；
  -  catastrophic-backtracking 正则 → 用户自有进程内 ReDoS/挂起。
- 注：这些 pattern 由用户在**自己策略**中编写，属自损可用性/正确性风险，**非外部越权路径**，也不赋予软层任何能力。
- 对照：`src/behavior/guard.ts` 第 42-46 行已对 `taskRegex` 做 try/catch（畸形即不匹配），guard 一侧是 fail-safe 的；仅硬层自身的 passPattern 缺保护。
- 修复方向：在 `validatePolicyDocument` 中编译所有 `passPattern`/`require.passPattern`，非法正则 fail-fast 报错，杜绝运行期崩溃与误 BLOCK。

---

## 四、退出标准对照（本次审计）

- 软层（Guard/UserModel/Preference）无法获得硬层 BLOCK：✅ 已证（类型隔离 + import 图 + 运行时只读）。
- 软层无法绕过用户授权：✅ 已证（写路径强制 ConfirmRequest，运行时无到达写方法的路径）。
- 无「软层间接拿到 BLOCK」的桥接 import：✅ 已证（constraint-engine/resolver 不 import guard/usermodel）。
- 待办（需用户确认）：R2 fail-closed 加固、R1 passPattern 编译期校验。

## 五、下一步

- 用户确认后，实施 R2 + R1：
  - R2：`agent/turn-stopping` 包裹 try/catch，异常即 `throw new PolicyViolationError`（fail-closed）；
  - R1：`validatePolicyDocument` 编译 `passPattern` 与 `require.passPattern`，非法即 `errors.push`；
  - 两处各加回归测试（畸形正则 → 验证失败；evaluatePolicy 抛异常 → 回合仍被 BLOCK）。
- 提交格式沿用先前（feat:/fix:/docs: + 中文描述），并补本 MV 文档。
