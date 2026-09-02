# Stage 2 — 策略与引擎核心（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 2 前半（最小 schema）+ Phase 3/4 的 v0 雏形
- **状态**：✅ 完成

## 做了什么

1. **策略层（`src/policy/`）**：
   - `schema.ts`：v0 硬规则模型 `{ id, trigger: 'code_change', require: 'tests_pass', enforcement: 'hard', remediation? }`——规则是纯数据（计划 §11.5），引擎不含项目特判。
   - `validator.ts`：结构校验（未知 trigger/require、重复 id、非 hard enforcement 一律拒绝）——损坏的策略必须响亮失败，绝不静默变成摆设。
   - `loader.ts`：约定位置 `<cwd>/.dsh-policy/policy.json`，读取 + JSON 解析 + 校验，错误统一 `PolicyLoadError`。
2. **证据层（`src/evidence/`）**：
   - `events.ts`：归一化事件 `code_change` / `test_run`（含时间戳、工具名、细节）。
   - `recorder.ts`：`EvidenceRecorder`——`lastCodeChangeAt()`、`hasPassingTestSince(ts)`；只存观察事实，不碰策略与用户状态。
3. **约束引擎（`src/engine/constraint-engine.ts`）**：纯函数 `evaluatePolicy(policy, evidence) → PASS | BLOCK + violations[{ruleId, reason, remediation}]`。零 Harness 依赖、零 I/O、完全确定性。
4. **单元测试 11 条**：validator 正反例、loader（含真实临时文件与约定路径）、recorder（过期通过不算数）、引擎四条案例的引擎级版本 + 规则未武装（D）+ 陈旧通过不满足。

## 怎么做的

- 引擎只接受归一化证据（计划 §Phase 4 exit criterion 的雏形）：`test_run.passed` 来自工具真实结果，不是模型话术。
- 判定语义：最近一次 code change 之后必须存在严格晚于它的 passing test run。

## 工程进度

- 下一阶段：Stage 3 —— 把引擎接到 Harness 生命周期上，四条 POC 集成测试全绿。
