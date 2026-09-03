# dsh-policy — Harness 架构核实记录

> 本文档记录 Stage 1 对 DeepSeek Harness 扩展 API 的**实测核实结论**（对应项目计划书 Phase 1）。
> 核实对象：`@deepseek-ai/*@0.1.1-rc.2`（npm `next` 版本线）+ 源码 `deepseek-ai/deepseek-harness@master`。

## 1. 依赖与版本

- 全家桶统一在 npm `next` 标签：`0.1.1-rc.2`（`latest` 标签停在 `0.0.1-rc.1`，已滞后；`dsh-agent@0.1.0-rc.6` 的 peer 要求 `^0.1.0-rc.6`，由 `0.1.1-rc.2` 满足）。
- 本项目锁定：`@deepseek-ai/dsh-agent`、`dsh-agent-loop`、`dsh-llm`、`dsh-tools`、`dsh-session`、`dsh-session-projection`、`dsh-system-prompt`、`dsh-scope` @ `0.1.1-rc.2`，`@deepseek-ai/cordis` @ `4.0.2`。

## 2. 插件形态（Cordis）

- 命名导出 `name` / `inject` / `apply(ctx, options)`；依赖用 `inject: string[]` 声明；经 `cordis.yml` 由 Loader 加载。
- 事件是类型化 Cordis 事件（声明合并），dispatch 模式属于事件契约（waterfall 必须调 `next()`，serial 无 `next()`）。
- 本项目对象形态 `ctx.plugin(dshPolicy, options)` 与 Loader 形态并存（`dshPolicy = { name, inject, apply }`）。

## 3. 回合流程与**阻止完成的确切机制**（关键核实项）

`packages/core/agent-loop/src/agent.ts`（`turn()`，约 L255-339）：

```
turn/start → [preStep: agent/pre-step waterfall (reject|enter)] → step … step/end
→ 若 turnEnds 且 inbox.nextStep 为空 → dispatch.serial('agent/turn-stopping', { agent, turn, signal })
→ 再次检查 inbox.nextStep → 为空才 break（turn/end）
```

结论（三条硬事实）：

1. **`agent/turn-stopping` 自身没有否决返回值**（`Promise<void> | void`），它是"检查点"而不是"闸门"。
2. **阻止完成 = 在检查点里 `agent.inject(userMessage)`**：`inject` → `send(input, 'next-step', false)` 进入收件箱，检查点后的 `if (turnEnds && inbox.nextStep.length === 0) break` 因此不成立，回合被重新打开并进入下一步——模型在下一条 user message 中看到补救指令。这正是计划书 §7 BLOCK→补救→重检回路的官方实现路径。
3. **硬拒绝 = 在检查点里 throw**：异常被回合循环捕获 → `turn/end { reason: { kind: 'error' } }`，回合只能以错误结束，不可能静默完成。dsh-policy 的策略：补救预算内 inject，预算耗尽 throw `PolicyViolationError`。

其它：`agent/pre-step` 的 reject 会让 `turnEnds = { kind: 'blocked' }`（可用于拒绝进入，不用于 remediation 循环）。`agent/turn-starting` / `turn-aborting` 尚不存在（上游 discussion #506）。

## 4. 工具执行管线

- 顺序：`tools/pre-execute`（waterfall，可 `{kind:'deny', reason}`）→ monotonic guards → `tools/execute` → 工具体 → `tools/post-execute`（waterfall，可 accept/block+feedback）→ `tools/result`。
- `ToolExecution = { callId, rootCallId?, name, arguments, agent?, … }`——**`exec.agent` 可用于按 agent 归属证据**（本项目用它给每个 agent 建独立 `EvidenceRecorder`）。
- 结果 `ToolExecutionResult = Success { value, content } | Failure { isError, error }`；本项目的 test-run 判定读取 `result.value`（真实执行结果），不读模型话术。
- 工具参数在策略评估前冻结，不可改写（审计一致性，对策略引擎有利）。

## 5. 会话事实

- `session/event` append-only 日志 + `agent.session.events`（rc.2 中的不可变快照 getter）提供可回放的运行时事实。
- 测试断言直接读 `turn/end` 事件的 `data.reason.kind`（`completed | blocked | error | aborted | max-tokens`）。

## 6. 测试模式（已照做）

- 官方哲学 "Prefer the real implementation over a mock"：真实 `LlmRuntime + SessionStore + SessionProjectionRegistry + SystemPrompt + ToolRuntime + AgentRegistry + AgentLoop` 栈，唯一 mock 是 LLM 适配器（参照 `packages/core/agent-loop/tests/agent.spec.ts` 与 `packages/test-support/agent-loop-testkit`）。
- 脚本式适配器回放 `StreamChunk[]`；工具调用脚本格式：`block-start(tool-call) → tool-call-delta → block-end(tool-call) → usage → finish(tool-calls)`。

## 7. 对后续阶段的影响

- Phase 5（引擎泛化）可继续用 inject+throw 双通道；`tools/pre-execute deny` 留作工具级硬门禁。
- 证据按 agent（WeakMap）隔离已实现；跨 session 关联与持久化留给 Phase 4。
- `ctx.systemPrompt.context()` 注入"生效中的硬规则摘要"尚未接线（计划 §11.3 的"解释与强制分离"），列为 Stage 5+ 工作。

## 8. Stage 6 补充核实：prompt 上下文的作用域可见性（实测踩坑）

- **插件 fiber 与 loop fiber 是兄弟 scope**：在插件 `apply(ctx)` 内直接 `ctx.systemPrompt.context(...)` 注册的动态上下文，对 agent loop 的 prompt 组装**完全不可见**（loop 经自己 scope 链调用 `systemPrompt.assemble`）。必须注册到 **`ctx.root`** scope（官方语义的 global 层，"scoped shadows global"）。已实测验证：root 注册后每一步请求的 messages 都包含规则摘要。
- **PromptContext 不是 system 槽文本**：`context()` 的产物是 durable user-role 快照，追加进每步请求的 `messages`（preStep 中 `[...claimed, context]`）；`system` 字段仍由 section/persona 组成。
- 取舍记录：root 注册的 effect 归 root 所有，插件 dispose 不会自动摘除（HMR 场景需自行管理 disposer）。MVP 接受此取舍，Stage 8+ 可改为 `ctx.effect` 包装。
- 工具级门禁实测：`tools/pre-execute` 返回 `{ kind:'deny', reason }`（不调 `next()`）→ 错误结果回给模型，工具体从未执行——MUST NOT 规则的正确挂点。

## 9. Stage 9 补充核实：root 注册的正确清理模式

- `systemPrompt.context()` 返回 disposer（官方 loop.spec 的用法：`const dispose = ctx.systemPrompt.context({...})`）。注册到 `ctx.root` 时，清理必须显式挂回插件自己的 fiber：
  ```ts
  const dispose = root.systemPrompt.context({ name, order, text })
  ctx.effect(() => dispose)   // 闭包必须【返回】disposer，而不是调用它
  ```
  `ctx.effect(() => { dispose() })` 不匹配任何重载（Effect 类型要求闭包返回 `Disposable`）。这样插件 dispose 时 root 上的注册一并注销——否则换策略重挂载后，模型看到的仍是旧规则文本（解释与强制分叉）。
- 教训（已写入回归测试）：跨 fiber 的效果注册必须回答"谁在何时注销它"；没有答案的注册就是泄漏。
- 补救预算的正确键控：turn-stopping payload 携带 `turn` 回合号；任何"每回合重置"的计数都必须以它为键，而不是挂在 agent 对象上只增不减。

## 10. Stage 13-15 补充核实：分层通道与组合形态

### 10.1 Prompt 分层通道（物理排序 = 层级优先级）

全部经 `ctx.root.systemPrompt.context()` 注册 + `ctx.effect(() => dispose)` 清理（§8/§9 模式）：

| order | name | 内容 | 求值方式 |
|---|---|---|---|
| 900 | `dsh-policy` | 硬规则摘要（`summarizeRules`，已上移至 `policy/resolver.ts` 供 resolver 复用） | 静态 |
| 910 | `dsh-policy/guards` | always + taskRegex 命中的引导 | 动态（每次组装对 `lastTaskText` 求值） |
| 920 | `dsh-policy/preferences` | Context Resolver 产出的偏好段（相关性匹配 + token 预算 800 + 淘汰） | 动态（对任务画像求值） |
| 925 | `dsh-policy/goal` | 链接目标一行（无链接即空串，零注入） | 动态 |

硬规则摘要现居 `policy/resolver.ts`（非插件入口）——这是为打破 `context → plugin` 分层环的关键移动，`summarizeRules` 是 resolver 与 900 通道的单一事实来源。

### 10.2 时序事实（两处实测）

- `user/message` 会话事件在 preStep 组装**之后**追加 ⇒ taskRegex 类通道（guards 910、preferences 920）从**下一次组装**起生效；测试用两轮 turn + 请求级断言验证。
- 插件激活时 `userModelPath` 只读加载一次（guard + preference 同模式）；变更经 Review CLI 走 User Model 单一写路径，重启/重挂载后生效。

### 10.3 作用域与生命周期（Stage 14）

- 三层作用域 global(0) < project(1) < task(2)，`SCOPE_RANK` 单一事实来源（`policy/schema.ts`）。
- **双机制单调性**：`resolvePolicies`（解析期保留强者 + 注记）与 `validateScopeMonotonicity`（校验期 fail-fast 拒绝弱化声明，含 `enabled:false` 与改定义两类）互不耦合；插件在 resolve 前先校验，违反即拒绝启动。
- 项目生命周期：插件只读 `project-registry.json`（`isActive`：未注册=active），`dsh-project` CLI 是唯一写者；非 active 项目用空文档兜底参与装配（规则零泄漏，global 仍生效）。
- global 来源：`~/.dsh-policy/policy.json`（缺省不致命；存在但损坏 → 响亮 `PolicyLoadError`）。

### 10.4 组合测试的等价 Loader（Stage 15，登记偏离）

- `@cordisjs/loader` 沙箱未解包（安装成功但 `node_modules` 空目录），改用 `src/config/loader.ts` 无依赖 YAML 子集解析器读取**真实 `examples/cordis.yml`**（`${ENV}` 插值、嵌套 map、内联 flow list）启动真实 Harness 栈——官方"真实配置启动"诉求的离线安全等价实现。生产环境仍应使用官方 Loader。
- 子集限制（登记债）：锚点、多行字符串、list-of-map 不支持；`cordis.yml` 引入 richer 语法时需扩展解析器。

### 10.5 一致性纪律（后续阶段沿用）

- 新增注入通道一律：`root.systemPrompt.context` + `ctx.effect(() => dispose)` + order 排在既有层之后（920/925 已按此办理）。
- 软层（guard/preference/goal）永远：类型隔离不进 `HardRule`、只读消费、prompt 物理排序在 900 之后。
- 900 摘要与 resolver bundle 共用同一渲染函数——"解释"与"resolver 产物"字节级一致，防止两处漂移。
