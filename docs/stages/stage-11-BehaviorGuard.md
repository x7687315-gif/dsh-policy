# Stage 11 — Behavior Guard 非阻塞行为引导（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 8（Behavior Guard）
- **技术基线**：[roadmap.md §4](../roadmap.md)
- **状态**：✅ 完成（58/58 测试全绿，新增 5 条）

## 做了什么

1. **Guard 模块（`src/behavior/guard.ts`）**：`BehaviorGuardRule` schema（`trigger.tools` / `trigger.taskRegex` / `trigger.always` 三种触发、severity 仅影响文案前缀、`provenance` 溯源字段为 Stage 12 预留）+ 相关性匹配 + 文案渲染。**类型隔离**：guard 不进入 `HardRule` 联合类型，`evaluatePolicy` 在类型层面就装不下它——"引导变成硬门禁"在编译期即不可能。
2. **双注入通道（复用已验证 API）**：
   - **任务相关**：`ctx.root.systemPrompt.context({ name:'dsh-policy/guards', order:910, text:动态函数 })`——每次组装对最新用户消息求值 `taskRegex`；order 910 使引导在 prompt 物理排序上永远位于硬规则（900）之后；
   - **工具相关**：`tools/post-execute` 在 accept 决策上**追加** `additionalContexts`——提醒紧跟行为发生点，且 guard 只能 ADD 上下文，永远不能 deny/block/改写。
3. **guard 存在于插件选项**（`options.guards`）；Stage 12 将从 User Model 加载后传入同一通道。

## 关键实测发现（写入测试注释）

- `user/message` 会话事件在 preStep 的 prompt 组装**之后**才追加——因此 taskRegex 守卫的文本从**下一次**组装开始生效（动态 text 每次求值、快照投影按变化追加）。首轮只看得到 always 守卫。这是上下文时序的重要事实。
- 非阻塞不变量的正确断言形态：guard 在场时硬规则照常强制（4 次请求 = 阻止后补救的额外步骤），而所有 turn/end 结果与违规信息中**永远不出现 guard id**。

## 测试 5 条

工具守卫提醒进入下一请求 / always+taskRegex 渲染且无关守卫不出现 / **非阻塞不变量**（硬规则照常强制 + guard 永不成为违规）/ guard 与满足的硬规则共存不影响完成 / disabled 守卫零贡献。

## 退出标准（计划书 §Phase 8）

> 重复的错误习惯能产生上下文相关的提醒，而不会错误地变成项目硬性要求。—— 双向测试钉死。

## 工程进度

- 下一阶段：Stage 12 User Model + 🧋 Review Center（候选 → 用户确认 → guard 落地，写路径唯一 + 审计），入口 roadmap §5。
