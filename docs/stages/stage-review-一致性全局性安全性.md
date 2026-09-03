# 一致性 / 全局性 / 安全性审查轮（阶段报告）

- **日期**：2026-09-03
- **范围**：Stage 13-15 全部新增代码（context resolver、config loader、preferences、project registry、goal store、plugin 装配）+ 文档一致性
- **状态**：✅ 完成（138/138 测试全绿；基线 134 → 138，+4 回归用例）

## 一、文档一致性修复（本轮第一步）

1. **README.md 过时**：状态段还停留在 "Stage 0–12 / 65 tests" → 更新为 Stage 0-15 / 134（现 138）/ 全部勾选框补齐 / 下一站 Stage 16。
2. **PROGRESS.md**：
   - “后续阶段”表三行列数错乱（Stage 13/14/15 的状态挤进了 3 列表）→ 重排为统一 5 列表，Stage 16 标注未开始；
   - “提交记录”缺 7 条（36609ca、ae2a0f9、398e3c2、ee67dea、ea64ce6、160d3de 等）→ 补齐，并加注 API 重建提交（64fb67a/071e467 同补丁）的历史说明。
3. **architecture.md**：新增 §10（Stage 13-15 实测事实）——900/910/920/925 四层通道表、`summarizeRules` 上移打破分层环、两处时序事实、双机制单调性、生命周期只读边界、等价 Loader 的偏离与子集限制、一致性纪律清单。

## 二、代码审查结论（逐维度）

### 安全性（安全性）

- **✅ 通过项**：config loader 的 `${ENV}` 只读 process.env、无 eval；软层（guard/preference/goal）类型隔离 + 只读消费不变量在 Stage 13-15 扩展中保持完好（goal 只注入一行且必须显式链接）；`evaluateTurn` fail-closed 有效；审计 trail 无运行时旁路。
- **F-C【修复】`archiveProject` 归档目录名含原始 projectId**：id 含路径分隔符时可把 rename 引导到 archive 目录之外（本地自伤型风险）。修复：目录名净化 `[^a-zA-Z0-9_-]→_`，registry key 保持原 id。回归测试：敌意 id `../../evil` → 归档目录名不含 `..`。

### 全局性（全局性）

- **✅ 通过项**：recentFiles/lastTaskText 有界（20/10 封顶）且仅内存；global 策略损坏响亮失败（与项目策略同纪律）；registry 损坏 fail-open 到“全部 active”是合理取舍（fail-closed 会禁用所有人的强制，已在代码注释记录理由）。
- 已知限制维持登记：taskRegex 通道跨会话共享任务文本（AssembleContext 无会话标识）。

### 一致性（一致性）

- **F-A【修复】`readGoals` 损坏文件抛异常**：goals 是纯咨询性上下文，损坏不应导致插件激活失败（与 loadRegistry 同口径）；同时与 policy/user-model 的“损坏响亮失败”形成正确的对照——**门禁相关状态响亮失败，咨询性上下文静默降级**。回归测试：坏 JSON → `[]` 不抛。
- **F-B【修复】`rulesEqual` 键序敏感**：`JSON.stringify` 依赖键插入顺序——同一规则在不同序列化键序下会被 `validateScopeMonotonicity` 误判为“改定义”而拒绝启动（假阳性）。修复：递归规范化（键排序）后比较。回归测试：键序不同的同规则 → ok。
- **F-D【修复】预算裁剪注记措辞**：`(+k rules omitted)` 在淘汰的是 guard/preference 时具有误导性 → 改为 `items`，同步测试断言。

### 明确不改（记录理由）

- registry 损坏 fail-open：见上，取舍正确。
- `parseCordisConfig` YAML 子集限制：Stage 15 已登记债， richer 语法出现时再扩展。
- `isPathLike` 可能把 URL 误判为文件：cap 20、仅影响偏好相关性，低风险（Stage 13 已登记）。

## 三、验证

- `pnpm typecheck` 0 错误；`pnpm test` **138/138**（21 文件，+4：goal×2、monotonicity×1、registry×1）；`pnpm build` 产物正常。

## 工程进度

- 文档与代码基线重新对齐；下一轮主线：Stage 16 基准测试（roadmap §9）。
