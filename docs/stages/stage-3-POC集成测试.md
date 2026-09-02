# Stage 3 — POC 集成测试：硬约束端到端强制（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 2（Hard Constraint Proof of Concept）——**第一个公开里程碑**
- **状态**：✅ 完成（18/18 测试全绿）

## 做了什么

1. **插件完整接线（`src/plugin/index.ts`）**：
   - `tools/post-execute`（waterfall）→ 按 matchers 把真实工具执行归一化为证据（`edit_file` 等 → code_change；`run_tests` 等 → test_run，passed 由工具结果值 + 可配置 passPattern 判定）。
   - `agent/turn-stopping`（serial）→ `evaluatePolicy`：PASS 放行；BLOCK 且补救预算未耗尽 → `agent.inject(补救指令)`（模型可见、source=plugin）；预算耗尽 → `throw PolicyViolationError`（回合只能以 error 结束，不可能静默完成）。
   - 证据与补救计数按 agent 用 WeakMap 隔离；matchers、预算均可配置。
2. **四条 POC 集成测试**（真实 loop/session/tool 栈，仅 LLM 适配器为脚本 mock）：
   - **Case A** 改码 + 测试过 → 回合 `completed`，3 次模型请求 ✅
   - **Case B** 改码 + 测试持续挂 → 注入 2 次补救后硬拒绝，`turn/end { kind: 'error' }` 且错误信息含规则 id，7 次请求，**从未完成** ✅
   - **Case C** 改码 + 无测试 → 第一次"完成"被阻止，补救注入后模型补跑测试 → `completed`，4 次请求 ✅
   - **Case D** 无改码 → 规则不触发，1 次请求，零打扰 ✅
   - 附加：补救消息确实进入收件箱的断言 + 脚本格式 sanity。
3. **端到端演示（`examples/demo.ts` + `examples/my-api/policy.json`）**：`pnpm demo` 可复现 BLOCK→补救→PASS 全过程（无 API key、零本地推理）。

## 怎么做的

- 测试栈搭建完全对照官方 `packages/core/agent-loop/tests/agent.spec.ts` 的 harness 模式；脚本回放 chunk 格式取自官方测试夹具。
- 断言锚定在**会话事实**（`turn/end` 事件的 reason.kind）上，而不是 mock 的内部状态。

## 退出标准达成（计划 §Phase 2）

> **A test proves that the Agent cannot successfully finish while violating the hard Project Policy.** —— Case B 与 Case C 联合证明。

## 工程进度

- 下一阶段：Stage 4 收尾（进度同步、README）。
