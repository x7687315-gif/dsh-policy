# Stage 8 — 证据持久化、HMR 安全与工程收尾（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 4 收尾（证据持久化/会话关联）+ §11.4/官方测试要求（HMR 安全）+ Phase 6 文档
- **状态**：✅ 完成（33/33 测试全绿）

## 做了什么

1. **持久化证据存储（`src/evidence/store.ts`）**：
   - `JsonlEvidenceStore`：按会话键控，每个 session 一个 `.jsonl` 文件（逐行 JSON，diff 友好、可回放）；首次触达时从文件**水合**历史证据；
   - 容忍崩溃导致的撕裂行（crash mid-append 不会杀死会话）；
   - `evidenceRoot` 未配置时退化为纯内存（现有用户零成本）。
2. **恢复会话语义（Phase 4 收尾的关键语义）**：进程重启后，同一 session 的未补救违规**继续拦截**——门禁不会因为重启而"失忆"。集成测试用两个独立 stack + 相同 session id 实证。
3. **HMR 安全（官方 registry 硬性要求）**：集成测试证明——dispose 插件 fiber 后所有强制效果解除（违规回合可以完成）、重新挂载不冲突且门禁恢复。
4. **插件改造**：证据从 WeakMap(按 agent) 迁移到 store(按 sessionId，计划 §Phase 4 的 event/session correlation)；新增 `evidenceRoot` 选项。
5. **策略编写指南（`docs/policy.md`，Phase 6 交付物）**：完整 schema（含 JSONC 注释示例）、两种规则的强制点对照表、作用域单调性说明、六条编写守则。

## 怎么做的

- 持久化是**追加写**（append-only），与会话日志的 append-only 哲学一致；读取侧逐行解析并跳过坏行。
- HMR 测试完全对应官方要求："every registry needs an HMR-safety test (dispose the contributing fiber, assert cleanup)"。

## 工程进度

- 计划书 Phase 4（运行时事件与验证层）核心条目全部落地；剩余见 PROGRESS.md。
