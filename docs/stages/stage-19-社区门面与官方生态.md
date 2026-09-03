# Stage 19 — 社区门面与官方生态接入（阶段报告）

- **日期**：2026-09-04
- **动机**：用户要求——① 把项目加入 DeepSeek Harness 官方插件社区（GitHub topic `dsh插件` / `dsh-plugin` 生态目录）；② README 门面升级（宣传图、徽章、界面演示截图），"主页太朴素"；③ **npm 发布暂缓**（用户决定：先让认识的人测试，再继续开发）。
- **状态**：✅ 完成

## 做了什么

1. **加入官方插件生态目录**：通过 GitHub API 为仓库设置 topics——`dsh`、`dsh-plugin`（与官方 Harness 仓库同款，进入 `github.com/topics/dsh-plugin` 插件目录）、`deepseek`、`deepseek-harness`、`cordis`、`ai-agents`、`policy-engine`、`agent`、`guardrails`。
   - **中文 topic `dsh插件` 的尝试与结果**：API 按 GitHub topic 规则（仅小写字母/数字/连字符）**拒绝**了中文名（422）。社区页面 `github.com/topics/dsh插件` 既然存在，说明中文 topic 需经**网页端**添加——已告知用户手动操作路径（仓库页 About 齿轮 → Topics 输入 `dsh插件`）；即便中文 topic 加不上，英文 `dsh`/`dsh-plugin` topic 已保证我们在生态目录中可被发现。
2. **README 门面升级**（保留全部既有内容）：
   - **主页宣传横幅**：用户设计的 dsh-policy 深蓝横幅（`docs/images/banner.jpg`）置于页首居中展示；
   - **徽章行**：CI 状态（GitHub Actions 实时）、166 tests passing、Node ≥20、MIT License、DeepSeek Harness plugin、feedback welcome；
   - **Screenshots 展示区**：管理台仪表盘与候选审查页两张真实截图（`docs/images/ui-dashboard.png` / `ui-candidates.png`，浏览器实拍入库），置于功能介绍之后，让读者先看见"能管理什么"；
   - **Community 区**：生态 topic 入口、Issue/PR 指引、Beta 反馈招募（明确说"三层模型是否匹配你约束 agent 的方式"是 beta 最需要验证的问题）。
3. **npm 发布暂缓**（用户决定）：本轮未做任何 npm 相关变更；README 中安装章节保持"尚未发布 npm"的诚实表述，发布清单留待重启时使用。

## 怎么做的

- 截图：重启 `pnpm ui`（真实 fixture 数据）→ 真实浏览器重载 → 仪表盘/候选页各拍一张 → PNG 直接写入 `docs/images/` 并同步在对话中目检；
- 链接与图片引用校验：30 个相对链接 + 3 个图片引用全部存在（0 缺失）；
- 冒烟服务器用后即清（5202 端口进程已终止）。

## Beta 测试计划（用户决定"让认识的人先测试"）

- **入口**：仓库 README 已含完整安装/运行指南（init → cordis.yml → ui），测试者无需读源码；
- **建议测试重点**（对应设计中最值得验证的假设）：三层模型是否好理解、管理台确认候选的流程是否顺手、硬规则在真实项目里的误报率（matchers 是否好调）；
- **反馈通道**：GitHub Issues（仓库已开启）；
- **节奏**：反馈汇总 → 决定 npm 发布时机与版本号策略（发布清单已备好：`npm whoami` → `npm publish`，首个版本建议 `--tag beta`）。

## 工程进度

- 功能与文档全部就绪；npm 发布按用户决定暂缓；下一轮可选项：反馈驱动的迭代、插件热生效、云端烟测。
