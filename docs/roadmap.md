# dsh-policy 后续任务规划与技术实施方案（Roadmap）

> **文档定位**：Stage 10-16 的实施规格前置稿。每个 Stage 开工前以本文档为技术基线，完工后以 [PROGRESS.md](./PROGRESS.md) 同步状态。
> **实施规格优先级**：[project-plan.md](./project-plan.md)（用户计划书）> 本文档 > 各阶段报告。
> **当前基线**（2026-09-03，`7a6a464`）：36/36 测试全绿；Phase 0-4 + Phase 3 退出标准达成；三个缺陷已修并钉回归测试。

---

## 1. 技术底座（已完成并实测验证，后续阶段直接复用）

后续所有阶段都构建在这套已验证的底座上，**不再重新发明**：

| 能力 | 已验证的实现 | 后续用途 |
|---|---|---|
| 工具级硬门禁 | `tools/pre-execute` waterfall → `{kind:'deny', reason}`，工具体不执行 | Stage 11 行为引导**不得**触碰此通道（非阻塞不变量） |
| 结果观察 | `tools/post-execute` waterfall → 归一化证据 | Stage 10 观察引擎的主输入之一 |
| 回合闸门 | `agent/turn-stopping` serial + `agent.inject()` 重开回合 / throw 硬拒绝 | Stage 10 捕获"被阻止的完成"信号 |
| 会话事实流 | `agent.session.events`（append-only 不可变快照）、`session/event` firehose | Stage 10 观察引擎的主输入 |
| Prompt 注入 | `ctx.root.systemPrompt.context({name, order, text})`，text 支持动态函数（每次组装求值）；清理必须 `ctx.effect(() => dispose)` | Stage 11/13 的引导与偏好注入通道 |
| 追加上下文 | `tools/post-execute` 的 `additionalContexts`（PostToolDecision） | Stage 11 工具触发的即时提醒 |
| 持久化模式 | 按会话 JSONL、追加写、撕裂容忍、水合恢复（`JsonlEvidenceStore`） | Stage 10/12 的观察日志与候选队列直接套用此模式 |
| 纯函数核心 | policy/engine/evidence 三层零 Harness 依赖，vitest 独立单测 | Stage 10-13 所有新核心逻辑沿用此分层纪律 |
| 测试模式 | 真实 loop/session/tool 栈 + ScriptedAdapter（唯一 mock）+ `turn/end` 事实断言 | 全部新阶段的集成测试模式 |
| 官方 UI 命令 | `@deepseek-ai/dsh-commands`（插件向 DSH UI 面注册人类命令） | Stage 12 Review Center 的原生入口 |

**版本纪律**：`@deepseek-ai/*@0.1.1-rc.2` 精确锁定。升级流程：新分支改版本 → 全量测试 → 读 diff 中 API 变化（历史教训：`snapshotEvents()` 曾改名 `events`；`ctx.effect` 闭包必须**返回** disposer）→ 合并。

---

## 2. 路线图总览

| Stage | 计划书 Phase | 核心交付 | 退出标准 | 预估规模 |
|---|---|---|---|---|
| 10 | Phase 7 | 行为观察引擎（零额外 LLM 调用） | "I observed a recurring pattern" 且绝不写入持久用户状态 | 2 个工作段 |
| 11 | Phase 8 | Behavior Guard（非阻塞行为引导） | 引导生效且被证明**永远无法**变成硬门禁 | 1 个工作段 |
| 12 | Phase 9-10 | User Model + 🧋 Review Center | 一切持久个性化记录可检视、可编辑、可删除、可溯源 | 2 个工作段 |
| 13 | Phase 11-12 | 偏好层 + Context Resolver | 只注入与当前任务相关的上下文，token 预算受控 | 2 个工作段 |
| 14 | Phase 13-15 | 作用域完整实现 + 项目生命周期 + 目标模型 | global/project/task 规则可预测、单调性有测试；归档项目规则不泄漏 | 2 个工作段 |
| 15 | Phase 16-17 | 全量集成 + 端到端验收（场景 A-E） | 真实 DSH 会话（Loader + cordis.yml + 云端 API）跑通全部场景 | 2 个工作段 |
| 16 | Phase 18 | 基准测试 | 产出约束有效性/个性化有效性/成本三份量化报告 | 1-2 个工作段 |

依赖链：10 → 11 → 12（严格顺序）；13 依赖 12（偏好需要 User Model 存储）；14 独立可并行；15 依赖 11-14 全部；16 依赖 15。

---

## 3. Stage 10 — 行为观察引擎（Phase 7）

### 3.1 目标与边界

从运行时事实中**确定性地**识别重复行为模式，产出"候选行为"，绝不自动写入任何持久用户状态（计划书 §2.1 的第一个试金石）。设计目标：**零额外 LLM 调用**——观察完全由本地确定性逻辑完成，分析型 LLM 调用是 Stage 16 之后的可选项，单独基准化。

### 3.2 模块与数据结构

```text
src/behavior/
├── observer.ts      # 事件流 → 观察记录（纯函数核心 + 一个 Harness 接线）
├── signature.ts     # 模式签名与去重
├── confidence.ts    # 确定性置信度公式
└── candidate.ts     # 候选行为 schema 与生成
```

核心数据结构（示意，非实现代码）：

```ts
// 观察记录：一条"发生了什么"的原子事实引用
ObservationRecord {
  kind: 'remediation_repeated'      // 同一规则在同一会话被补救 ≥2 次
     | 'hard_block_repeated'        // 同一规则跨会话硬拒绝 ≥N 次
     | 'tool_denied_repeated'       // 反复尝试被禁工具
     | 'user_correction'            // 用户消息命中纠正性语言特征（启发式，低精度）
     | 'test_fail_streak'           // 测试连续失败后用户手动接管修复
  signature: string                 // 去重键：`${kind}:${ruleId|toolName|主体}`
  sessionId, at: number
  evidence: EvidencePointer[]       // 指向 session 事件 seq 与 JSONL 证据行
}

// 候选行为：观察的聚合，等待用户裁决
CandidateBehavior {
  id, signature                     // 与观察同键 → 天然去重
  occurrences: number               // 累计出现次数
  distinctSessions: number          // 跨会话数（权重高于同会话重复）
  firstSeen, lastSeen: number
  confidence: number                // 见 3.4
  draftMessage: string              # 建议的行为提醒文案（模板生成，非 LLM）
  status: 'candidate' | 'confirmed' | 'rejected'
  rejectedAt?: number               # 拒绝墓碑：同签名候选不得自动复活
}
```

### 3.3 信号源与 Harness 集成点

| 信号 | 接线 | 说明 |
|---|---|---|
| 补救/阻止事件 | 插件自身在 turn-stopping 注入与抛错时，调用 `observer.note(...)` | 我们自己的强制行为就是最高质量的观察信号源 |
| 工具拒绝 | `tools/pre-execute` deny 分支 | `tool_denied` 证据已有，计数即可 |
| 用户纠正 | `session/event` firehose 中 `user/message` 事件 | 确定性启发式：消息长度 < 200 且命中纠正词表（"不对/又/还是/我说过/别再"等，可配置）；文档必须声明这是低精度信号，仅作候选 |
| 失败接管的启发 | `turn/end {reason.error}` 后紧跟用户消息包含修复动词 | 同上，启发式 |

### 3.4 关键算法

- **签名去重**：`signature = kind + 规范化主体`（ruleId / 工具名 / 纠正消息的规范化摘要——小写、去数字与路径、词干化截断）。同签名观察聚到同一候选，`occurrences` 与 `distinctSessions` 递增。
- **置信度（确定性公式，写进文档并配单测）**：
  `confidence = min(1, 0.2·min(occurrences,5)/5 + 0.4·min(distinctSessions,3)/3 + 0.2·recency + 0.2·signalQuality)`
  其中 `recency = exp(-daysSinceLast/14)`；`signalQuality`：remediation/hard_block 类 = 1.0（运行时铁证），user_correction 启发式 = 0.4。阈值默认 `confidence ≥ 0.6 且 occurrences ≥ 2`（**实现期修正**：原草案写 ≥3，但公式下单次出现封顶 0.573 永不晋级、双会话双次 ≈0.747 晋级——"运行时铁证出现两次"已值得给用户看，故取 2；阈值可配置）。
- **候选升级**：观察日志（JSONL，套用 `JsonlEvidenceStore` 模式，独立目录 `observations/`）→ 阈值命中 → 写入候选队列 `candidates.json`（原子写：临时文件 + rename）。
- **拒绝墓碑**：`rejected` 状态永久保留签名，同签名新观察继续累计但**永不**再次进入待审队列，除非用户显式重开（Stage 12 提供命令）。

### 3.5 测试策略

- 单测（纯函数）：合成事件序列 → 期望的观察/候选/置信度；去重；墓碑；阈值边界。
- 集成测试：ScriptedAdapter 构造"两个会话各忘跑测试一次" → 断言候选产生、`occurrences=2, distinctSessions=2`，且**用户模型文件不存在**（非阻塞不变量的文件级断言）。

### 3.6 风险

- 启发式精度低 → 缓解：置信度权重低 + 用户裁决门（Stage 12）兜底；文档明示。
- 观察日志膨胀 → 滚动窗口（默认 90 天）+ 按签名压缩。

---

## 4. Stage 11 — Behavior Guard（Phase 8）

### 4.1 目标

把**用户确认后**的候选转化为上下文相关、**永远非阻塞**的行为引导。

### 4.2 模块与数据结构

```text
src/behavior/guard.ts    # BehaviorGuard schema + 相关性匹配 + 注入
```

```ts
BehaviorGuardRule {
  id, message: string              # 注入给模型的提醒文案
  trigger: {
    tools?: string[]               # 这些工具刚执行后提醒（additionalContexts 通道）
    taskRegex?: string             # 用户消息/任务描述命中时提醒（prompt 通道）
    always?: boolean
  }
  severity: 'info' | 'warn'        # 仅影响文案前缀与排序，不影响通道
  enabled: boolean
  provenance: { candidateId, confirmedAt }   # 溯源：哪条候选、何时被谁确认
}
```

### 4.3 注入通道（复用已验证 API）

- **任务相关**（taskRegex 命中）：`ctx.root.systemPrompt.context({ name:'dsh-policy/guards', order: 910, text: () => renderGuards(taskOfCurrentAssembly()) })`——动态 text 每次组装求值，天然实现"只在相关时出现"。
- **工具相关**（tools 命中）：`tools/post-execute` 返回 `{kind:'accept', additionalContexts:[提醒消息]}`——工具结果之后紧跟提醒，最贴近行为发生点。
- 排序约定：硬规则 context（order 900）永远在引导（910）之前，偏好（920）最后——三层优先级在 prompt 物理排序上可见。

### 4.4 非阻塞不变量（本阶段的核心测试）

- **类型隔离**：`BehaviorGuardRule` 不进入 `HardRule` 联合类型；`evaluatePolicy` 的入参类型 `Resolution` 根本装不下 guard——编译期即不可能。
- **运行期测试**：构造"guard 消息存在 + 硬规则全 PASS"的会话 → 断言回合正常完成；构造"guard 存在 + 硬规则违规" → 断言 BLOCK 原因只含硬规则 id，guard 从不出现在 violations。
- **通道测试**：guard 的 additionalContexts 出现在下一请求 messages 中（复用 Stage 6 的请求检查手法）。

---

## 5. Stage 12 — User Model 与 🧋 Review Center（Phase 9-10）

### 5.1 User Model 存储

```text
src/usermodel/{schema.ts, store.ts, audit.ts}
~/.dsh-policy/user-model.json        # 用户级（跨项目）
```

```ts
UserModelRecord {
  id
  kind: 'behavior_pattern' | 'preference'
  value: object                      # 具体内容（guard 定义 / 偏好声明）
  scope: 'user'                      # 'project' 级覆盖放项目 .dsh-policy/，Stage 14
  enabled, createdAt, updatedAt
  provenance: { candidateId?, confirmedAt, confirmedBy: 'user' }   # §11.7：谁能授权？——用户
}

# 变更审计（append-only，独立文件 user-model.audit.jsonl）
AuditEntry { at, actor: 'user' | 'system-readonly', op: 'create'|'update'|'disable'|'delete', recordId, diff }
```

- **写入路径唯一**：`UserModelStore` 的变更方法要求 `confirmationToken`（由 Review 流程签发）；插件运行时（观察引擎、guard 注入）只持有只读句柄。Agent 运行时**不存在**任何到达写方法的代码路径——用依赖注入方向保证，而非运行时检查。
- 原子写 + schema 版本字段（`version: 1`）+ 迁移函数占位。

### 5.2 Review Center（🧋）

两条入口，MVP 先做 (a)：

**(a) CLI（Stage 12 交付）**：`pnpm review`（tsx 脚本）：列出待审候选 → 逐条展示证据（观察记录 + 指向的 session 事件摘要）与置信度 → stdin 选择 确认 / 编辑文案 / 拒绝 / 跳过 → 确认即写 User Model + 生成 BehaviorGuard / Preference，拒绝即写墓碑。全程本地、零 LLM。

**(b) DSH 原生命令（Stage 15 一并做）**：通过 `@deepseek-ai/dsh-commands` 向 Harness UI 面注册 `policy review` 人类命令——这是官方"plugin-owned human command registry"，让 Review 出现在 DSH 的交互界面里而非独立 CLI。技术要点：命令回调跑在 Harness 进程内，直接复用同一 store 实例。

### 5.3 关键不变量与测试

- 确认后的候选 → guard 生效（集成测试：确认"改 API 后检查调用方"→ 相关任务中出现提醒）。
- 拒绝的候选不复活（单测：同签名新观察累计，队列无变化）。
- 删除/停用 User Model 记录 → 对应 guard 立即消失（动态 text 每次组装求值，天然生效；测试断言）。
- 审计完整性：每次变更恰有一条 AuditEntry（顺序性测试）。

---

## 6. Stage 13 — 偏好层与 Context Resolver（Phase 11-12）

### 6.1 偏好 schema

```ts
PreferenceRecord {
  id, scope: 'user' | 'project'
  kind: 'style' | 'workflow'         # style: async-await、引号风格…; workflow: 提交前先看diff…
  value: string
  appliesTo: { language?: string; fileGlob?: string[]; taskRegex?: string }   # 相关性判定输入
  priority: number                   # 同类冲突时排序
  enabled, provenance（同 Stage 12）
}
```

### 6.2 Context Resolver（本项目"反记忆堆 dump"的关键模块）

```text
src/context/resolver.ts   # 纯函数：任务画像 + 三层规则 → 最小上下文包
```

- **输入**：当前用户消息与近期会话摘要（任务画像：涉及语言/文件/工具）、Resolution（硬规则）、guards、preferences。
- **相关性判定**（确定性，无 LLM）：硬规则**无条件全量**；guard 按 trigger 匹配；preference 按 `appliesTo` 匹配（语言从文件扩展名映射、glob 用 `picomatch`、taskRegex 同 guard）。
- **Token 预算**：上下文包目标 ≤ N tokens（默认 800，可配；估算用 chars/3.5 经验比率并留 15% 裕量）。超预算时按 层级 → priority → recency 淘汰；**硬规则永不淘汰**，实在超限则截断 guard/preference 并在包尾注明 `(+k rules omitted)`。
- **输出与注入**：`ContextBundle { sections: [{name, text, order}] }` → 仍走 `systemPrompt.context` 动态 text（order 900/910/920 分层）。冲突排序规则文档化：硬 > 引导 > 偏好，同层按 priority。

### 6.3 测试

- 相关性单测矩阵（任务×appliesTo）；
- 预算淘汰顺序测试（构造 50 条偏好 + 3 条硬规则，断言硬规则全在、淘汰从最低优先级偏好开始、截断注记出现）；
- 集成断言：与任务无关的历史偏好**不出现**在 adapter 捕获的请求里（延续 Stage 6 手法）。

---

## 7. Stage 14 — 作用域、生命周期与目标模型（Phase 13-15）

### 7.1 作用域完整实现

- **global 来源**：`~/.dsh-policy/policy.json`（用户主目录）+ 项目 `.dsh-policy/policy.json`，插件启动时同时加载两份 → 现有 `resolvePolicies` 已支持多文档合并与单调性，只改加载层。
- **task scope**：任务实体携带 `rules: HardRule[]`（仅允许**新增**类规则；校验器拒绝 task 级出现 `enabled:false` 的同名覆盖——把单调性从"解析期保留强者"升级为"校验期直接拒绝弱化声明"）。
- 单调性测试矩阵：global+project+task 三层 × 增/删/改声明 → 期望的解析结果与冲突报告。

### 7.2 项目生命周期（Phase 14）

```text
project-registry.json: { [projectId]: { state: 'active'|'paused'|'completed'|'archived', … } }
```

- 状态迁移命令进 CLI（Stage 12 的 CLI 扩展子命令：`project pause|complete|archive`）。
- 解析期过滤：非 active 项目的规则**整组**不参与 resolution；归档 = 目录移入 `archive/` + 注册表标记（历史保留，可检视不可生效）。
- 测试：归档项目规则不影响新会话（集成断言 prompt 中无其规则文本、turn-stopping 不评估其规则）。

### 7.3 目标模型（Phase 15，最小化）

`GoalNode { id, parentId, title, projectId?, linkedTaskIds }` 四层（长期→里程碑→短期→今日任务）。**边界**（计划书明示）：只在任务显式关联目标时注入一句目标上下文（Context Resolver 的一个输入），不建任何自动规划、不自动分解——分解由用户驱动，系统只提供挂接与回填。

---

## 8. Stage 15 — 全量集成与端到端验收（Phase 16-17）

### 8.1 组合与真实运行

- 单一插件入口组合全部子系统（观察、guard、user model、resolver、作用域），选项分区：`{ policy?, evidenceRoot?, userModelRoot?, review?, context?: { tokenBudget } }`。
- **真实部署形态**：`cordis.yml` 示例（dsh-policy + `@deepseek-ai/dsh-llm-deepseek` 云端适配器 + API key 走环境变量）——LLM 调用全部走 DeepSeek 云端，本地零推理（硬件约束不变）。
- **官方组合测试要求**：产品可见插件必须有"通过 Loader 启动 test-only `cordis.yml`"的真实组合测试（官方原文：手搭 `ctx.plugin` 不够）——用 `@cordisjs/loader`（或官方 test-support 的 loader-smoke 模式）在测试里加载真实配置文件。

### 8.2 场景 A-E（计划书 §Phase 17）逐条落地

| 场景 | 测试形态 | 关键断言 |
|---|---|---|
| A 硬规则 | ScriptedAdapter 集成（已有 Case A-D 基础上补真实工具名） | 阻止→补救→放行全链 |
| B 行为观察 | 两个会话重复犯错 → 候选 → CLI 确认 → guard 持久 | 墓碑/溯源字段完整 |
| C 偏好 | 确认偏好后相关任务注入、无关任务不注入 | 请求级断言 |
| D 权威边界 | 候选被拒 → User Model 无变化（文件级断言） | 拒绝不复活 |
| E 作用域 | 项目 A/B 各自规则互不影响（双 stack 双策略） | 无串扰 |
| + 真实烟测 | 带 key 的 e2e（无 key 自动 skip，官方模式） | 云端一次真实回合走通 BLOCK/PASS |

---

## 9. Stage 16 — 基准测试（Phase 18）

- **约束有效性**（确定性回放集，ScriptedAdapter）：违规检出率、误拦截率、误放行率、补救成功率、完成正确率——语料 = 场景 A-E 的参数化变体（×规则数 ×噪声工具调用）。
- **个性化有效性**：偏好遵循率（脚本检查产出消息/工具序列）、提醒出现率、候选接受/拒绝比、guard 激活前后同错误复现次数差（模拟会话序列对比）。
- **成本**（硬指标）：每请求 token 开销（ContextBundle 字符数/3.5，对比无插件基线）；钩子延迟（pre/post-execute 与 turn-stopping 的 `Date.now()` 差值 P50/P95）；**额外 LLM 调用数 = 0（MVP 断言，直接写进测试）**；存储开销（每会话 JSONL 字节）。
- 产出：`bench/report.json` + 文档解读，进仓库。

---

## 10. 横切工程事项

1. **发布**：npm publish 走 GitHub Actions（`NPM_TOKEN` secret），changesets 管版本；发布前冻结 rc 依赖并跑全量 + bench。
2. **安全**：GitHub 用 fine-grained PAT（仅本仓库、短时效）；任何 secret 只走环境变量；项目内 `evidenceRoot` 默认指向仓库外或加入 `.gitignore` 模板。
3. **可观测**：`debug: true` 时经 `ctx.logger` 输出结构化行（现有模式沿用）；BLOCK/deny/补救计数暴露为插件状态对象，供 UI/诊断读取。
4. **Windows**：全部路径经 `node:path`；文件名 sanitize 已有（session id → `_`）；测试在 Windows 本机跑（现状）+ CI Linux 双平台。
5. **已知取舍登记**：store 热路径同步 fs（Stage 8 记录）→ Stage 13 前后改异步缓冲写；观察日志滚动窗口。

## 11. 风险登记册

| 风险 | 等级 | 缓解 |
|---|---|---|
| rc API 漂移（升级破坏） | 高 | 锁版本；升级专用分支 + 全量测试；architecture.md 持续记录 API 事实 |
| 启发式观察精度低致候选噪音 | 中 | 置信度低权重 + 用户裁决门；阈值可配；墓碑防骚扰 |
| Prompt 上下文膨胀 | 中 | Stage 13 token 预算硬上限 + 截断注记 + 基准量化 |
| 解释/强制分叉（Stage 9 缺陷复发） | 中 | 回归测试已钉；新注入通道一律走 `ctx.effect(() => dispose)` 模式 |
| 官方 UI 命令 API 不稳定 | 低 | CLI 先行，DSH 命令集成放 Stage 15 并允许降级 |
| 观察日志/用户模型并发写 | 低 | 单进程假设（DSH 每 session 单进程）；原子写；审计日志兜底 |

## 12. 与计划书条文的映射

- §2.1 用户权威 → Stage 12 写路径唯一 + confirmationToken + 审计
- §2.3 机器可验证 → 全程证据驱动（Stage 10 的 remediation/hard_block 信号即运行时铁证）
- §2.5 单调性 → Stage 14 校验期拒绝弱化（升级现有解析期保留）
- §11.3 解释/强制分离 → Stage 11 非阻塞不变量 + 分层 order
- §11.4 每条硬规则有测试 → 各阶段测试策略强制；Stage 15 场景 A 集大乘
- §11.7 授权可溯 → provenance 字段贯穿 guard/preference/user model
- Phase 18 零额外 LLM 调用 → Stage 10 设计原则 + Stage 16 硬断言
