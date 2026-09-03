# Stage 17 — Web 管理界面（计划外增强）

- **日期**：2026-09-04
- **动机**：用户反馈——纯后端（手写 JSON + CLI）的方式让他人增加/修改约束、偏好与行为提醒**不够泛用**，需要一个前端帮助用户**一站式管理**这些事务。
- **状态**：✅ 完成（156/156 测试全绿，+11 用例；真实浏览器冒烟通过）

## 设计决策（与项目纪律逐条对齐）

1. **零依赖本地 Web 服务器**：`src/ui/server.ts` 用 Node `node:http` 手写 REST API + 静态服务，前端为无框架单页（vanilla JS + fetch）。延续项目的依赖最小纪律（Stage 13 已回避 zod/picomatch，本轮同样不用 React/Vite/Express）——`pnpm ui` 即起，无构建步骤。
2. **写路径纪律不破（计划 §2.1）**：UI 服务器是继 Review CLI 之后的**第二个合法写者（用户代理）**——每一次变更都来自浏览器里的显式用户动作，并流经与 CLI 完全相同的屏障：
   - 用户模型变更 → `UserModelStore` + `ConfirmRequest{via:'review-ui'}` + 审计日志；
   - 候选确认/编辑 → 复用 `applyReview` 纯函数；拒绝 → 墓碑（永不复活）；确认后 `markHandled` 出队；
   - 策略编辑 → **先过 `validatePolicyDocument` 再落盘**（坏规则——包括畸形正则——永远到不了磁盘），原子写（tmp+rename）。
   插件运行时保持只读；它在**下次激活**时重读策略与用户模型。
3. **安全姿态**：仅绑定 `127.0.0.1`（本地用户即权威，与 CLI 完全一致），不提供远程暴露；证据文件名白名单 `[\w.-]+\.jsonl` 拒绝路径穿越（有测试）；请求体 1MB 上限。
4. **诚实边界（写入 UI 页面与文档）**：插件在激活时读取策略与用户模型，UI 的修改在**插件下次重载/新会话**生效——运行中会话的内存态不受影响。

## 功能清单（六个标签页）

| 标签页 | 能力 |
|---|---|
| 仪表盘 | 项目/全局硬规则数、待审候选、生效提醒、生效偏好、受管项目、证据会话七项计数 |
| 硬规则 | 双作用域（项目/全局）规则表 + 表单化增改删 + 启停；验证型（内置要求/自定义工具+passPattern）与禁止型（MUST NOT）分表单；**保存前服务端校验，校验错误逐条回显** |
| 待审候选 | 证据指针、出现次数/跨会话、置信度徽章、草拟文案 → 确认 / 编辑文案 / 拒绝（含确认弹窗说明墓碑语义）/ 跳过 |
| 提醒与偏好 | 用户模型记录表（含来源候选 ID 便于溯源 §11.7）、启停/删除（全部写审计）；手动新增提醒（always 触发）与偏好（language/fileGlob/taskRegex/priority） |
| 项目生命周期 | 注册表项目列表 + 暂停/恢复/完成（归档含目录迁移，留在 CLI 并在 UI 中说明） |
| 证据 | 只读：会话文件列表（大小/时间）+ 最近 50 条事件查看（撕裂行以 `{torn:true}` 透出，不隐藏） |

## 实现要点

- **REST API**：`GET /api/overview | /api/policy | /api/candidates | /api/records | /api/projects | /api/evidence[/:file]`，`PUT /api/policy?scope=`，`POST /api/review | /api/records`，`PATCH|DELETE /api/records/:id`，`POST /api/projects/:id/state`。
- **候选队列是投影**：服务器启动时 `createBehaviorRuntime` 会从 `observations.jsonl` 重建候选队列（Stage 12 设计）——测试夹具因此按正确契约造观察记录而非直接造队列文件（首版测试踩到这一点，已按契约修正）。
- **测试 11 条（`tests/integration/ui-server.test.ts`）**：绑定 127.0.0.1:0 的真实服务器上走 HTTP——overview 计数、前端可达、坏策略 400 且原文件分毫不动、好策略原子落盘、确认(带编辑文案)→持久记录+守卫投影+队列出队+审计文件、拒绝→墓碑、未知候选显式上报、偏好增/停/删全审计（via=review-ui）、项目暂停/恢复/非法状态 400、证据列表/读取/撕裂行透出/路径穿越拒绝。
- **冒烟**：真实浏览器端口启动 → 首页 HTML、overview 计数与 fixture 一致、records API 返回真实数据。

## 怎么用的（用户视角）

```bash
pnpm ui --policy .dsh-policy/policy.json --candidates <观察目录> --model ~/.dsh-policy/user-model.json
# 打开 http://127.0.0.1:5178
```

## 还有没有做的（诚实登记）

- 归档（含目录迁移）留在 CLI（`pnpm project archive`），UI 上说明原因（HTTP 触发目录移动需更谨慎的确认流）；
- 目标模型（goals）的编辑界面未做（goal 本身只读注入，编辑器随 GoalNode 回填 CLI 一并考虑）；
- 运行中插件的"热生效"需要插件侧文件监听（file-watch + 重读），登记为后续增强；
- 前端为功能优先的朴素风格，无国际化层（中文为主，界面文案集中便于翻译）。

## 工程进度

- 计划书 Phase 0-18 全部达成 + Stage 17 Web 管理界面（计划外增强）。剩余：npm 发布、云端烟测、taskRegex 多会话隔离、store 异步写、插件热生效。
