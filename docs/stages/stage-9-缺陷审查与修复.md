# Stage 9 — 全量缺陷审查与修复（阶段报告）

- **日期**：2026-09-03
- **性质**：代码审查轮（对应计划书 §11 长期可维护性原则的执行）
- **状态**：✅ 完成（36/36 测试全绿，含 3 条新回归测试）

## 审查方法

逐文件审查全部源码（plugin / policy / engine / evidence / store）+ 插件生命周期推演（挂载→多回合运行→卸载→重挂载），重点核对：状态的生命周期归属（谁的预算？何时重置？）、root 作用域注册的清理路径、校验器与执行器对同一 schema 的语义一致性。

## 发现并修复的缺陷

### 缺陷 1【重大】补救预算跨回合永不重置

- **机理**：`remediationsUsed` 是 `WeakMap<agent, number>`，只增不减，也不按回合区分。
- **影响**：任何一回合约束持续违规耗尽预算（默认 2 次）后，**之后所有回合的第一次违规就直接硬抛错**，永久失去补救机会——把"预算内补救、预算外拒绝"退化成了"一次性宽恕、终身拒绝"。
- **修复**：预算改为按 `agent → Map<turn, count>` 键控（turn-stopping payload 携带回合号），每个新回合自动获得完整预算。
- **回归测试**：两个回合各 2 次注入 + 硬抛错（旧代码第二回合 0 次注入、仅 2 个请求即抛错；断言 `turn1注入数 + 2` 与总请求 8）。

### 缺陷 2【重大】root 注册的规则文本在卸载后不清理

- **机理**：规则摘要注册在 `ctx.root` scope（Stage 6 实测必需），但 disposer 被丢弃；cordis 只回收插件自己 fiber 的效果。
- **影响**：① dispose 后旧规则文本继续注入 prompt——有解释、无强制；② 重新挂载时同名注册抛 duplicate 被静默吞掉——**换新策略后模型仍看旧规则文本，运行时却执行新策略**，解释与强制分叉，直接违反计划书 §11.3。
- **修复**：保存 `systemPrompt.context()` 返回的 disposer，用 `ctx.effect(() => disposer)` 挂到插件 fiber——卸载即注销。注意 cordis 的 effect 闭包必须**返回** disposer（`() => dispose`），而非调用它。
- **回归测试**：挂 A 策略（含 rule-a）→ 验证 prompt 文本含 rule-a → dispose → 挂 B 策略（rule-b）→ 验证新回合文本**含 rule-b 且不含 rule-a**。

### 缺陷 3【中】deny 规则省略 trigger 时成为静默摆设

- **机理**：校验器允许 `denyTools` 规则省略 `trigger`，但插件只对 `trigger === 'always'` 的规则建 deny 映射——省略 trigger 的规则能通过校验却**永远不会被强制**。
- **影响**：正是计划书最反对的"损坏策略静默变成 no-op"。
- **修复**：① 校验器收紧——deny 规则必须显式 `trigger: "always"`；② 插件侧改为**形状判定**（`'denyTools' in rule`），双保险，杜绝拼写歧义导致的漏强制。
- **回归测试**：无 trigger 的 deny 规则被校验器拒绝。

## 顺带改进

- `inject = ['systemPrompt']`：插件激活等待 system-prompt 服务就绪——杜绝"服务未装载时规则文本静默缺失"（有强制、无解释，同样是 §11.3 违例）。
- `document.scope` 兜底：options 未指定 scope 时尊重 policy.json 里的 `scope` 字段。
- `summarizeRules` 不再依赖 trigger 字符串判型（与插件主体一致）。

## 验证

- `pnpm test` 36/36（新增 `tests/integration/regression.test.ts` 3 条）
- `pnpm typecheck` 干净；`pnpm build` 产物正常；`pnpm demo` 行为不变。

## 工程进度

- 主线功能未被本轮改动（Phase 7+ 仍未启动）；本轮提升了既有强制路径的正确性保证。
