# Stage 10 — 行为观察引擎（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 7（Behavior Observation）
- **技术基线**：[roadmap.md §3](../roadmap.md)
- **状态**：✅ 完成（53/53 测试全绿，新增 16 条）

## 做了什么

1. **纯函数核心（`src/behavior/`，零 Harness 依赖、零 LLM 调用）**：
   - `types.ts`：`ObservationRecord` / `CandidateBehavior` / 默认阈值（含公式参考点的文档注释）；
   - `signature.ts`：三类签名——规则类（`remediation_repeated:<ruleId>`）、工具类、**纠正文本规范化签名**（小写化、数字与路径折叠为占位符、去标点保留 CJK、取前 8 词）——"又改错了 /a/b/c 第3次"与"又改错了 /x/y 第9次"落在同一签名；
   - `confidence.ts`：roadmap §3.4 的确定性公式 + 五类信号的 `SIGNAL_QUALITY`（运行时铁证 1.0/0.9，启发式 0.4），文档内写明三个参考点（1 次=0.573 永不晋级 / 2×2=0.747 晋级 / 60 天陈旧=0.550 衰减）；
   - `observer.ts`：聚合（occurrences/distinctSessions/首末时间/证据指针封顶 5 条）、阈值晋级、**拒绝墓碑**（同签名永不复活）、hydrate 重启恢复、全量重算投影。
2. **持久化（`store.ts`）**：`observations.jsonl`（追加、撕裂行容忍）+ `tombstones.json` + `candidates.json`（**原子写**：tmp + rename，每次 note 全量重写——小 N 且文件永不漂移）。
3. **插件接线（4 类信号源）**：
   - `turn-stopping` 补救注入 → `remediation_repeated`（按规则）；
   - `turn-stopping` 预算耗尽硬拒绝 → `hard_block_repeated`；
   - `tools/pre-execute` deny → `tool_denied_repeated`；
   - `session/event` firehose 的 `user/message` → `user_correction` 启发式（短消息 + 可配置纠正词表，中英文默认词表）。
   - **opt-in**：`behavior.enabled !== true` 时整个运行时不创建（默认零行为、零文件）。
4. **测试 16 条**：签名规范化（含 CJK）、置信度三参考点、聚合/墓碑/hydrate、持久化重启恢复、纠正启发式正反例、**集成场景**——两个独立会话各忘跑测试一次 → 聚合为 `occurrences=2, distinctSessions=2, confidence≥0.6` 的候选 + **`user-model.json` 不存在的文件级断言**（非阻塞不变量）+ 默认不开启时磁盘零文件。

## 怎么做的

- 观察引擎对我们自己的强制行为记账（补救/硬拒绝/工具拒绝）——运行时铁证优先于文本启发式，后者仅作低权重候选。
- 踩坑记录：单测用极小假时间戳导致 recency 项归零（距"现在"两万年）——给 `BehaviorOptions` 补了时钟注入缝（`now`），这是确定性公式可测性的必要 API。

## 实现期对 roadmap 的一处修正

阈值默认从草案的 `occurrences ≥ 3` 修正为 `≥ 2`（公式推导：单次永不晋级、双会话双次 ≈0.747）——roadmap §3.4 已同步标注修正理由。`test_fail_streak` 信号类型已保留占位，实现推迟（需要跨事件关联，见剩余工作）。

## 退出标准（计划书 §Phase 7）

> 系统能说"I observed a recurring pattern"而不把它当作已确认的用户规则。 —— 集成测试证明：候选产生且聚合正确，用户状态文件不存在。

## 工程进度

- 下一阶段：Stage 11 Behavior Guard（确认后的候选 → 非阻塞引导），入口 roadmap §4。
