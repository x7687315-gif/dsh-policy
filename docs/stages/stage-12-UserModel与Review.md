# Stage 12（核心）— User Model 与 Review 流水线（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 9（User Model）+ Phase 10（Daily Review）核心
- **技术基线**：[roadmap.md §5](../roadmap.md)
- **状态**：✅ 核心完成（64/64 测试全绿，新增 6 条）；交互式 CLI 壳与 DSH UI 命令留待下一轮

## 做了什么

1. **User Model 存储（`src/usermodel/`）**：
   - `schema.ts`：`UserModelRecord`（kind/scope/enabled/时间戳/溯源）——**每条记录自带 §11.7 的答案**：谁授权（confirmedBy:'user'）、何时、来自哪个候选；
   - `store.ts`：**单一写路径**——所有变更（create/update/disable/delete）必须携带 `ConfirmRequest`（via: review-cli/review-ui/user-api），调用点被迫在代码里回答"这是用户授权的吗"；原子写（tmp+rename）；每次变更追加一条审计到 `user-model.audit.jsonl`（append-only，含操作类型与 via）；损坏或未知版本文件**响亮失败**——静默忘记用户规则比拒绝启动更糟。
   - `guards.ts`：只读投影——enabled 的 behavior_pattern 记录 → 插件 `guards`。**插件运行时对用户模型没有任何到达写方法的代码路径**（计划 §2.1 的结构性保证）。
2. **Review 流水线（`src/review/review.ts`，纯函数）**：`applyReview(candidates, store, decisions, request, {onReject})`——confirm/edit → 创建带溯源的持久记录；reject → 签名墓碑（经 hook 通知观察运行时，候选永不复活）；skip → 无操作；unknown-candidate 显式上报。CLI/UI 只是这层逻辑的薄壳。
3. **闭环打通（`options.userModelPath`）**：插件激活时**只读加载**用户模型文件，确认的记录立即成为生效的 guard——集成测试证明：store 创建一条 behavior_pattern → 插件运行 → 提醒文本出现在下一个请求里，且**审计文件行数在插件运行前后不变**（只读消费的文件级证明）。

## 测试 6 条

store 全操作 + 审计顺序断言 / 重启恢复 + 损坏响亮失败 / 未知 id 响亮报错 / applyReview 四种裁决结果（含 edit 修改文案、reject 触发墓碑、ghost 候选上报）/ disabled 记录不投影 / 插件只读消费闭环。

## 实现取舍（诚实记录）

- 确认候选的 guard trigger 一律 `always: true`（签名里只有规则 id，无法可靠反推工具触发）——trigger 精修留给 CLI 编辑功能；
- `ConfirmRequest` 不是安全边界，是**结构性强制**：让每个调用点必须声明用户授权（计划书 §11.7）；
- 交互式 CLI（stdin 审查循环）与 DSH UI 命令（`@deepseek-ai/dsh-commands`）未实现——纯函数库已就绪，壳是薄封装，放下一轮。

## 退出标准对照（计划书 §Phase 9/10）

> 用户可以检视并控制系统记住的一切持久个性化事实。—— 记录可检视（JSON 文件+审计）、可编辑/停用/删除（store API）、变更全程审计、拒绝不复活（墓碑贯通 Stage 10）。"谁授权了这条规则？"每条记录自带答案。

## 工程进度

- 下一轮：Stage 12 收尾（CLI 壳）→ Stage 13 偏好层与 Context Resolver（roadmap §6）。
