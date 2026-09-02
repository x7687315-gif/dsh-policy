# Stage 0 — 仓库奠基（阶段报告）

- **日期**：2026-09-03
- **对应计划书**：Phase 0（Project foundation）
- **状态**：✅ 完成

## 做了什么

1. **技术选型确认**（基于前期技术调研）：
   - TypeScript 5（`"type": "module"`、strict）+ Node ≥ 20 + pnpm + vitest；
   - 目标框架为 DeepSeek Harness（`github.com/deepseek-ai/deepseek-harness`，Cordis 插件体系），依赖包 `@deepseek-ai/dsh-*`（Stage 1 安装锁定）；
   - License：MIT。
2. **脚手架**：`package.json`（scripts: test / typecheck / demo）、`tsconfig.json`（NodeNext + strict）、`vitest.config.ts`、`.gitignore`、`README.md`、`LICENSE`。
3. **文档体系**（本项目的硬性流程要求）：
   - `docs/project-plan.md`：用户原始计划书，作为唯一实施规格；
   - `docs/PROGRESS.md`：阶段划分与进度同步总表；
   - `docs/stages/`：每阶段一份报告（本文件即第一份）。
4. **远端仓库**：通过 GitHub API 创建 `x7687315-gif/dsh-policy`（public，按计划书第 10 节「公开仓库尽早开始」策略），首次 commit 并 push。

## 怎么做的

- 环境检查：Node v24.20.0 ✅、git 2.55 ✅、pnpm 原缺失 → `npm i -g pnpm` 安装（v11.25.0）。
- 纯脚手架阶段不引入运行时依赖；`pnpm install` 留到 Stage 1 与 `@deepseek-ai/dsh-*` 一起做，保证 lockfile 反映真实依赖。

## 工程进度

- **当前位置**：计划书 Phase 0 的退出标准达成——陌生人打开仓库可以知道：解决什么问题（README 三层模型与不变量）、为什么不同于普通 memory/prompt 系统、为什么做成 Harness 扩展、如何跑第一个 PoC（待 Stage 3 补充快速开始）。
- **下一阶段**：Stage 1 —— 安装锁定 `@deepseek-ai/dsh-*` 依赖，跑通最小插件，核实 `agent/turn-stopping` 的阻止机制，产出 `docs/architecture.md`。
