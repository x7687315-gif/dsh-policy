# Stage 1 — 环境与 Harness 接入验证（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 1（DeepSeek Harness architecture verification）
- **状态**：✅ 完成

## 做了什么

1. **依赖落地**：全线安装并精确锁定 `@deepseek-ai/*` @ `0.1.1-rc.2`（npm `next` 版本线；`latest` 标签滞后不可用）+ `@deepseek-ai/cordis@4.0.2`；dev 依赖 typescript 5.9 / vitest 3.2 / tsx。
2. **扩展 API 实测核实**（结合官方仓库源码 + 已安装包的 `.d.ts`）：
   - 插件形态：`name` / `inject` / `apply(ctx, options)`，对象形态与 Loader 形态并存 ✅
   - `tools/post-execute`（waterfall）：可观察每次真实工具执行与结果 ✅
   - `agent/turn-stopping`（serial 检查点）：**自身无否决返回值；阻止完成 = 检查点内 `agent.inject()` 重开回合（检查点后循环会重读 inbox），硬拒绝 = throw 使回合只能以 error 结束** ✅
   - `ToolExecution.agent` 字段可用于按 agent 归属证据 ✅
   - 会话事实：`agent.session.events`（rc.2 的不可变日志快照）✅
3. **冒烟测试**：真实 Harness 栈（LlmRuntime + SessionStore + SessionProjectionRegistry + SystemPrompt + ToolRuntime + AgentRegistry + AgentLoop）+ 脚本式 MockAdapter（唯一 mock，遵循官方测试哲学）→ 回合正常完成。
4. **核实结论落档**：[architecture.md](../architecture.md)。

## 怎么做的

- 浅克隆官方仓库对照源码读 `agent-loop/src/agent.ts` 的 `turn()` 循环，确认检查点后 `if (turnEnds && inbox.nextStep.length === 0) break` 的重读逻辑——这是"inject 阻止完成"的机制根据。
- 遇到两个版本差异并解决：`Session.snapshotEvents()` 在 rc.2 改名 `events`；pnpm v11 的构建脚本白名单移到 `pnpm-workspace.yaml`。

## 工程进度

- 计划书 Phase 1 退出标准达成：观察事件 ✅ / 注入上下文 ✅（`agent.inject`，`systemPrompt.context` 留 Stage 5+）/ 拒绝工具 ✅（API 已核实，集成在 Stage 3+）/ 检查结果 ✅ / 拦截回合完成 ✅。
- 下一阶段：Stage 2 策略与引擎核心。
