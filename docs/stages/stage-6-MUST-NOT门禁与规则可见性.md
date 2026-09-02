# Stage 6 — 插件 v1：MUST NOT 门禁与规则可见性（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 4/5/6 部分（策略驱动 matchers、工具级硬门禁、解释与强制分离）
- **状态**：✅ 完成（29/29 测试全绿）

## 做了什么

1. **策略驱动 matchers**：`codeChangeTools` / `verificationTools` 从 policy.json 的 `evidence` 段读取（内置默认兜底，规则级 passPattern 最优先）——matchers 成为策略数据而非插件选项。
2. **`tools/pre-execute` 硬门禁**：`denyTools` 规则 → 命中即返回 `{ kind:'deny', reason }`，**工具体从未执行**，并记录 `tool_denied` 证据。集成测试证明：违禁工具的 execute 标志始终为 false。
3. **规则可见性（解释 ≠ 强制，计划 §11.3）**：`ctx.systemPrompt.context()` 注入"生效中的硬规则"摘要。
   - **踩坑记录（重要架构事实）**：插件 fiber 与 loop fiber 是兄弟 scope，插件 scope 内注册的 context 对 loop 的 prompt 组装**不可见**——必须注册到 `ctx.root` scope（官方语义的 global 层）。已写入 architecture.md §8。
   - PromptContext 以 durable user-role 快照追加进每一步请求的 messages（不是 system 槽）——集成测试断言首轮请求里包含规则 id 与 "runtime-enforced" 字样。
4. **新集成测试 4 条**：双规则（tests+typecheck）双验证齐活才完成 / 缺 typecheck 同样被阻止并补救 / MUST NOT 门禁 / 规则文本可见性。

## 怎么做的

- 保留 v0 兼容：计划书示例 JSON 形状（`trigger`/`require` 字符串）仍被接受，新形状为增量。
- 断言仍锚定会话事实与 adapter 捕获的真实请求，不依赖 mock 内部状态。

## 工程进度

- 下一阶段：Stage 7 —— CI 与文档同步。
