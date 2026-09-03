# Stage 18 — 真实环境验证与安装简化（阶段报告）

- **日期**：2026-09-04
- **动机**：用户要求——① 全面检查代码在**真实使用环境**下可用（引入真实使用环境），发现问题注重全局性与安全性地修复；② 调研安装流程能否简化，能则大胆简化（确保安全可靠），不能则维持现状。
- **状态**：✅ 完成（166/166 测试全绿，+10 用例；构建产物 CLI 全命令实测；真实浏览器操作验证通过）

## 一、真实环境验证：测试盲区与修复

审查方法：对照"真实部署 vs 测试环境"的差异点逐项排查——构建产物（dist）、默认路径发现、损坏文件、CLI 可执行性、真实浏览器。

### F1【真实缺陷，已修】缺省策略缺失会炸掉整个 Harness 会话

- **场景**：用户把 dsh-policy 挂进 cordis.yml，但项目还没有 `.dsh-policy/policy.json`（新项目第一天）→ `loadPolicyFile` 抛 ENOENT → **插件激活失败 → 会话启动失败**。测试从未覆盖"无内联选项的默认发现路径"。
- **语义修正**：**缺失 ≠ 损坏**。显式断言（inline `policy` / `policyPath`）缺失仍响亮失败；默认发现路径缺失 → 空规则集运行（`source: 'absent'`）；**损坏仍然响亮失败**（静默执行空隙比拒绝启动更糟——原有纪律不变）。
- **实现**：抽出新导出函数 `resolveProjectPolicy(options, cwd, projectActive)`（可测性 + 结构提升），apply() 改用它。

### F2【真实缺陷，已修】显式但未创建的全局策略路径同样炸会话

- **场景**：用户照抄示例配置设置 `globalPolicyPath`，但还没创建该文件 → 激活失败。全局层本就是"可选"设计（默认路径缺失早已容忍），显式路径却不容忍——不对称。
- **修正**：抽出新导出函数 `resolveGlobalPolicy(options)`——全局文件**缺失 → "无全局规则"**（无论默认还是显式路径）；**损坏 → 响亮失败**。

### F3【健壮性，已修】UI 遇到损坏策略文件会 500

- `loadPolicyOrNull` 现捕获解析错误返回 null——管理台在用户手改坏 policy.json 时仍可打开（渲染"无规则"），**只读视图宽容，插件仍响亮失败**（职责分界保持）。

### 回归测试（`tests/integration/real-env.test.ts`，7 条）

缺失默认策略 → 空规则集不崩溃 / 发现的文件被加载 / 损坏仍响亮 / 显式路径缺失仍响亮 / 内联优先 + 非激活空文档 / 全局缺失容忍 / 全局损坏响亮。

## 二、dist 构建产物验证（此前从未测过！）

**关键盲区**：真实用户安装的是 `dist/` 产物，而全部 145 条测试都跑 TS 源码——tsdown 打包是否正确从未被验证。

- 新增 `tests/integration/dist.test.ts`（CI 先 `pnpm build` 再测试；dist 缺失时跳过）：
  - **库入口**：`import('../../dist/index.mjs')` 暴露 `dshPolicy` / `PolicyViolationError`；
  - **端到端强制**：服务用源码、**插件挂 dist 产物**——违规回合被打包产物真实拒绝（`turn/end error` + 规则 id），证明 npm 安装形态具备完整强制能力；
  - **统一 CLI**：`node dist/cli.mjs --help` 正常。
- CI 增加构建步骤，保证该验证在每次 push/PR 都执行。

## 三、安装流程简化（结论：能，且已实施——但只做安全的部分）

### 简化前的不便

① 没有脚手架，用户要手写第一个 policy.json；② 四个工具分散（review/project/ui 各自 `pnpm tsx src/...`，只有仓库内可用）；③ 没有全局命令。

### 已实施的简化

1. **统一 CLI**：`src/cli/main.ts` 分发 `dsh-policy init | review | project | ui`——单执行路径，子命令模块只导出 `run*Cli(argv)` 不再自行执行（**彻底消除打包后双重执行的隐患**，这是设计取舍而非实现细节）。
2. **`dsh-policy init` 脚手架**：一键生成 `.dsh-policy/policy.json`（含一条可用硬规则）+ 打印下一步指引。安全边界：**永不覆盖已存在的策略文件**（无 --force 直接拒绝；--force 也先过校验器）；脚手架内容本身过 `validatePolicyDocument`——init 永远产不出插件会拒绝加载的策略。
3. **bin 入口**：`package.json` 新增 `"bin": { "dsh-policy": "bin/dsh-policy.mjs" }`（shebang 包装器 import dist/cli.mjs）；GitHub 安装后 `npx dsh-policy init` 即用。
4. **多入口构建**：tsdown entry `{ index, cli }`，静态资源路径三级回退（源码运行 / 仓库 dist 运行 / 安装后运行）。
5. **刻意不做**（安全边界）：无 postinstall 脚本（供应链风险，pnpm 默认拦截）；init 不碰 init 之外的任何文件；不自动注册全局命令；npm 发布仍走正式流程。

### 实测（构建产物，非源码）

`node dist/cli.mjs --help` ✓ / `init` 创建脚手架 ✓ / **重复 init 被拒绝** ✓ / `project pause` ✓ / `bin/dsh-policy.mjs` 包装器 ✓ / dist 运行 `ui`（静态资源回退链生效，API + 页面正常）✓

**实测还抓到并修掉一个打包级崩溃**：main.ts 尾部残留 `void fileURLToPath` 语句在打包后触发 `ReferenceError`——真实执行才发现，静态测试测不出。

## 四、真实浏览器操作验证（browser-use）

用真实浏览器驱动 `pnpm ui`（完整 fixture：策略 + 用户模型 + 两个会话的观察记录 + 证据文件）：

1. **仪表盘**：七项计数与 fixture 完全一致，"已连接 ✓"；
2. **待审候选**：卡片完整渲染（置信度 75%、2 次/2 会话、证据指针、草拟文案）；
3. **点击"确认"** → 页面队列排空 → **服务端核验**：用户模型新增记录（`confirmedBy:'user'` + `candidateId` 溯源）、队列 `handled.json` 登记、审计落盘——§2.1 屏障在真实浏览器操作下完整生效；
4. **视觉截图**：深色主题布局、导航、卡片渲染全部正常。

冒烟中把仓库 fixture 当作用户模型挂载导致其被写入——已 `git checkout` 恢复并清理审计残留（教训记录：冒烟必须用临时目录数据）。

## 验证

- `pnpm test` **166/166**（25 文件，+10）；`pnpm typecheck` 0 错误；`pnpm build` 多入口产物正常；`pnpm bench` 不受影响。

## 工程进度

- 计划书 Phase 0-18 + Stage 17/18 完成。剩余：npm 发布（bin/init 就绪）、云端烟测、插件热生效、taskRegex 多会话隔离、store 异步写。
