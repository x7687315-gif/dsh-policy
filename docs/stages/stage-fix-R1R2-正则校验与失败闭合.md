# 安全加固 R1+R2（正则校验 fail-fast + 回合闸门 fail-closed）

- **日期**：2026-09-03
- **关联审计**：[stage-audit-L1L2-架构安全审计](./stage-audit-L1L2-架构安全审计.md)
- **技术基线**：审计结论「软层无法获得 BLOCK」成立；本步只加固「硬层自身不被意外击穿」。
- **状态**：✅ 完成（69/69 测试全绿，typecheck 干净；基线 65 → 69，+4 用例）

## 做了什么

1. **R1（F-04b）：passPattern 校验期编译、fail-fast**（`src/policy/validator.ts`）
   - 新增 `validateRegex(pattern, where, errors)`：在 `new RegExp(pattern)` 抛错时收集明确的校验错误。
   - 接入两处 passPattern 来源：
     - `evidence.verificationTools[].passPattern`（原仅类型检查）；
     - `rule.require.passPattern`（原仅类型检查）。
   - 畸形正则现在在加载/校验阶段即被拒绝 → `loadPolicyFile` 抛 `PolicyLoadError` → 插件拒绝启动，绝不带着坏正则跑起来。
2. **R1b（防御纵深）：运行时正则失败闭合**（`src/plugin/index.ts` post-execute）
   - 原 `new RegExp(pattern).test(text)` 裸调用改为 try/catch：编译失败 → 记日志 + `passed=false`。
   - 即使将来有绕过 loader 的内联 `options.policy` 携带坏正则，也不会让 post-execute 瀑布崩溃或丢失证据；闸门会因「无通过记录」而拒绝（fail-closed），而非静默放行。
3. **R2（F-04c）：回合闸门 fail-closed**（`src/plugin/index.ts`）
   - 抽出导出函数 `evaluateTurn(resolution, evidence)`，用 try/catch 包裹 `evaluatePolicy`：
     正常返回 `PASS|BLOCK`；**若评估自身抛错（证据损坏/内部异常）→ 抛 `PolicyViolationError`**，回合被拒，绝不静默完成。
   - 硬层的 BLOCK 权限因此不会被未捕获异常「弄丢」。

## 怎么做的

- **最小改动、不动架构边界**：R1 全在 validator（校验职责本就该在此）；R2 的 `evaluateTurn` 仍位于插件编排层，包裹纯函数引擎，未引新跨层依赖。`evaluatePolicy` 与 `Resolution` 的类型隔离保持不变。
- **fail-fast 配置（fullstack-dev 纪律）**：畸形正则「早失败、响亮失败」，符合计划书对策略加载「broken policy must be loud」的既有约定。
- **测试**（4 条，全部新增）：
  - `tests/unit/policy-engine.test.ts` +2：畸形 `evidence.verificationTools[].passPattern` 与 `rule.require.passPattern` 被拒；合法正则（含锚点/转义）通过。
  - `tests/unit/fail-closed.test.ts` 新建 +2：抛出证据的 `evaluateTurn` 抛 `PolicyViolationError`；正常 `PASS` 原样返回（happy path 行为不变）。
- **验证**：`pnpm typecheck` 干净；`pnpm test` 69/69 全绿（10→11 测试文件）。

## 还有没有做的（诚实登记，未做的不编造）

- **未修（不在本轮范围，且经审计判定为「非当前代码问题」）**：
  - Preference 层（Stage 13）尚未实现，无运行逻辑；待实现时须同样只走 910/920 非阻塞通道，绝不接 `evaluatePolicy`。
  - guard `taskRegex` 通道多会话隔离（stage-12 已知限制）：与本步的正则安全无关，留待后续。
  - F-01/F-03/F-06~F-11（来自 `已发现的代码问题.md`）指向仓库中不存在的文件或未来 Stage，本轮不碰；该问题文档本身未读源码，按用户「不虚假记录」要求未套用其虚构代码。
- **R2 仅覆盖「评估抛错」路径**：目前未加「证据 recorder 本身损坏导致字段缺失」的集成级断言（单测已覆盖函数级 fail-closed）。如需更强保证，可后续在集成测试中注入损坏 recorder。

## 退出标准对照

- 硬层策略加载：畸形 passPattern 不再能「带着跑」→ fail-fast ✅
- 回合闸门：异常时拒绝回合而非静默完成 → fail-closed ✅
- 软层（Guard/User Model/Preference）仍无法获得 BLOCK → 审计结论未变 ✅

## 工程进度

- 下一轮：Stage 13 偏好层与 Context Resolver（roadmap §6）；如需，可先补 R2 集成级损坏断言。
