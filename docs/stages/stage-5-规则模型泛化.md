# Stage 5 — 约束规则模型泛化（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 3（Constraint Rule Model）+ Phase 13 作用域雏形
- **状态**：✅ 完成

## 做了什么

1. **规则模型 v1（`src/policy/schema.ts`）**：从单一条款泛化为两类规则——
   - `ToolPassRule`："触发后（code_change）工具 Y 必须通过"——`require` 支持内置名（`tests_pass`/`typecheck_pass`）或显式 `{ kind:'tool_pass', tool, passPattern? }`；
   - `DenyToolsRule`（MUST NOT）："永远不得调用这些工具"；
   - 全部规则携带 `enabled`（激活/停用）；需求→工具映射走注册表 `DEFAULT_REQUIRE_TOOL`。
2. **作用域解析器（`src/policy/resolver.ts`）**：`resolvePolicies(scoped)` 合并多 scope 策略并强制 **Constraint Monotonicity（计划 §2.5）**——更具体的 scope 只能"增加"硬规则；跨 scope 重复 id 保留更强 scope 版本并响亮上报冲突；`enabled:false` 的规则被排除。
3. **引擎升级（`src/engine/constraint-engine.ts`）**：输入从"单文档"改为"解析后的规则集"；按工具名验证证据（`hasPassingToolRunSince(since, tool)`），多规则相互独立评估；deny 类规则不在此评估（由 pre-execute 门禁更早拦截）。
4. **单元测试扩到 18 条**：v1 校验正反例、monotonicity 三条（可增/不可删/冲突保留强者）、多规则独立评估、停用规则不强制。

## 怎么做的

- 证据层从 `test_run` 泛化为 `tool_pass`（带 tool 名）+ 新增 `tool_denied` 事件，recorder API 相应演化为 `hasPassingToolRunSince(since, tool)`。

## 工程进度

- 计划书 Phase 3 退出标准达成：**硬规则可作为数据表示并由引擎评估，无需硬编码特例**。
- 下一阶段：Stage 6 —— 插件 v1 接线。
