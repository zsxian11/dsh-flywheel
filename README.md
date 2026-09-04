# dsh-flywheel

[English](README.en.md) | 中文

面向 **DeepSeek Harness（DSH）** 的「会话飞轮」插件 —— 仓外独立仓库（v1），与 Cursor 侧共用同一套索引与检索协议。

一句话目标：在**单会话隔离**下，让一条龙长会话接近 Cursor 的「当前句只带工作集」；用项目级产物图 + 倒排在会话之间传递短卡，而不是把 transcript 糊在一起。

## 仓库结构

```
packages/core/                # 协议 + 检索编排（不绑定 sqlite / 不依赖任何 DSH 运行时包）
packages/lexical-sqlite/      # v1 LexicalIndex + GraphStore：SQLite FTS5 + 边表（node:sqlite, WAL）
packages/dsh-bundle/          # DSH 侧 bundle：Host 插件 + Web 设置卡片（./client）
```

计划书全文见 `_docs/flywheel-plugin-plan.md`（本仓库不再复述设计细节）。

## 包职责（对应设计 §6.1）

| Cordis name | 入口 | 职责 |
|---|---|---|
| `flywheel-store` | `@dsh-flywheel/dsh-bundle/store` | 注册 `flywheel` 设置 namespace，提供 `ctx.flywheel`，按设置组装 Provider |
| `flywheel-lexical-sqlite` | `@dsh-flywheel/dsh-bundle/lexical-sqlite` | 挂载 `sqlite-fts`（v1 必装） |
| `flywheel-inject` | `@dsh-flywheel/dsh-bundle/inject` | `agent/pre-step` 注入工作集（step 1 + 真人句，digest 去重） |
| `flywheel-index` | `@dsh-flywheel/dsh-bundle/index` | 文件事件 + 用途句入库 + 纠正作废 |
| `flywheel-window` | `@dsh-flywheel/dsh-bundle/window` | idle 换窗 `compactNow` |
| `flywheel-trim` | `@dsh-flywheel/dsh-bundle/trim` | `tools/post-execute` 截断超大工具结果（含 `read`，默认 8000 字） |
| `tool-flywheel` | `@dsh-flywheel/dsh-bundle/tools` | `project_search` / `session_search` / `session_read` |
| `flywheel-web` | `@dsh-flywheel/dsh-bundle` | 空 Host apply，让 Web 扫描到包根上的 `dsh.client` |
| （浏览器） | `@dsh-flywheel/dsh-bundle/client` | 设置页「会话飞轮」卡片（中英字典） |

服务面保持小：`ctx.flywheel.retrieve / ingest / queueClaimExtract / config()`。

## 安装（本地 dev 实例，离线）

`@dsh-flywheel/*` 尚未发布，三个包之间通过 `link:` 相对依赖相互引用，因此**离线只能用目录 link 安装**（tarball 之间离线无法解析传递依赖，已实证不可行）。装进正在运行的 dsh（本例 profile `web`）：

```sh
cd /Users/zhaoshuxian/Desktop/myproject/dsh-flywheel

# 1) 等当前 dsh 任务结束后再构建（运行中不要改 lib/）
pnpm --filter @dsh-flywheel/core build
pnpm --filter @dsh-flywheel/lexical-sqlite build
pnpm --filter @dsh-flywheel/dsh-bundle build    # host：lib/*.js（含包根空 apply）
pnpm --filter @dsh-flywheel/dsh-bundle bundle   # 浏览器：lib/client.js

# 2) 三个包一起以 link 加进 profile（core / lexical-sqlite 是普通依赖，
#    dsh-bundle 因声明 dsh.bundle 自动进入 profile layers）
npx @deepseek-ai/dsh plugin --profile web add \
  link:./packages/core link:./packages/lexical-sqlite link:./packages/dsh-bundle

# 3) 验证 layer 挂载（可先 --dump-config 看 flywheel 层）
npx @deepseek-ai/dsh --profile web --dump-config

# 4) 重启实例使新增 bundle 层生效
npx @deepseek-ai/dsh web --no-open
```

说明：

- 运行时 `@deepseek-ai/*` 从 dsh 安装目录的共享 module fallback 解析（无需 registry）。
- 卸载：`npx @deepseek-ai/dsh plugin --profile web remove @dsh-flywheel/dsh-bundle`（再 remove 另外两个包）。
- 设置卡片需要 `lib/client.js`（`pnpm --filter @dsh-flywheel/dsh-bundle bundle`）以及 patch 里的包根行 `flywheel-web`。首次 bundle 前在本仓执行一次 `pnpm install` 以安装 `tsdown` / `lightningcss`。
- 发布到 npm 后可用 `dsh plugin --profile web add dsh-flywheel-dsh-bundle` 一步安装；届时把三个包的 `link:` 依赖改回版本号即可。

安装后：

- **设置 → 插件配置** 出现标题为「会话飞轮」的卡片（不是 Flywheel / 包名）。
- 首步真人消息注入 ≤ `ftsK` 张节点卡 + 1 跳 ≤ `hopExtra` 张；digest 相同不重复注入。
- 工具结果（含 `read`）超过 `maxToolResultChars`（默认 8000）时截成首尾预览；后续步骤不再整文件回放。trim 在 spill 内侧先截断；若官方 spill 仍写出文件，会去掉 `read` 结果里的 spill 路径。
- 工具循环 / 子代理不重复检索；写出的 pptx/pdf/xlsx/… 落 `PRODUCED` 边。
- 用户纠正（`不对|不是|改成|作废…`，大小写/中英均可）把最近 3 条 active claim/change 标 `superseded`。
- 规则命中后，后台用 `summarizationModel`（默认 `deepseek-v4-flash`）把用途句改成 ≤80 字目的 + 绑定路径；超时 8s 或失败保留规则摘录，绝不 await 在 pre-step（§7.3 claim flash）。

## 配置（schema = 设置页 = CLI JSON，禁止硬编码 K）

字段与默认值见 `packages/core/src/config.ts` 的 `DEFAULT_CONFIG`；DSH 侧的 schemastery 镜像见 `packages/dsh-bundle/src/config.ts`。关键约束：

- `ftsK` / `hopExtra` / `vectorK` 正整数；`hop` 只能是 `1`（v1 不开放多跳）。
- `maxChars` 500–8000。
- `maxToolResultChars` 1000–32000；`trimToolResults` 默认开。这只截断**当轮**写入历史的工具结果，不会少一次模型 API 调用。
- `lexicalBackend` 必须已挂载；v1 只挂载 `sqlite-fts`。选 `elasticsearch` 但未装 Provider 时保存被拒绝（fail loud），sqlite 检索不受损。
- `vectorBackend: off`（默认）时热路径零 embedding；v1 不实现 ES / 云向量，接口与卡片字段已留位（P6/P7）。
- 密钥走 `role('secret')`，不出现在 settings 读取响应。

## 当轮为什么还是贵

工具循环里**每一步都是一次 Messages**。飞轮不能把 142 次调用合成 1 次。账单是两笔：

1. **调用次数**：模型每 `read` 一个文件就停下来再请求。persona 已要求同一轮并行 `grep` / `glob` / `read`，不要每读完一个文件就复述。
2. **提示词体积**：`flywheel-trim` 在 spill 内侧把工具结果（含 `read`）截到 `maxToolResultChars`，避免官方 spill 把大 `read` 写成文件再被模型读回去。compaction 默认要到窗口约 80% 才因压力触发；换窗在本轮第一步先试 `compactIfNeeded('forced')`，官方包则回退到 `'context-overflow'`（同样绕过压力阈值）。`compactNow` 仅 idle。这不打断前缀缓存的追加语义。
3. **首次思考回传**：DeepSeek 会把每一步的 `reasoning_content` 原样塞进后续请求。High 下一开场中英混写的长调查会同时当 output 计费、再当后面每一步的 input。飞轮不能截断这段（官方 passback 规则）；真正有效的是把 reasoning 调到 `off` / `low`。persona 只约束「用用户语言、先要点再动手」，压不住 High。

飞轮管不了的杠杆（P0 用户配置，不在本仓）：瘦 preset（`coding-search` 含 `/plan` 与受限 web）、spill `maxInlineBytes: 12000`、compaction `thresholdRatio: 0.5` + `retainTokens: 16384`、逛代码不要用 High reasoning。换 Exa/Perplexity 搜索后端仍属后续 Host 项。

## 检索协议（热路径唯一算法，§4.3）

倒排 `search(query, { k: ftsK })`（active、当前项目）→ 可选向量 RRF（默认关）→ 恰好 1 跳（边集 PRODUCED/DESCRIBES/CITES/SUPERSEDES/CONTINUES/PART_OF）→ 展开 ≤ `hopExtra` → 丢弃仍 active 的 SUPERSEDES dst → 其它会话节点只留 title+summary（≤200 字）→ 渲染 ≤ `maxChars` → `digest = sha256(sorted ids + query + lexicalBackend)`，相同则 unchanged。全程零 LLM。

## 同会话一条龙

新开会话选「编码检索」。简单修直接改。复杂任务先 `/plan`，把方案写到 `docs/changes/<slug>.md` 再批准；用户说「开始实现」时本轮第一步会尝试压缩旧历史，并注入该方案卡。工具表开局就有 `web_search`，但仓库事实先 grep，只有当前外部文档才搜。要换题说「另外…」。

## 开发

```sh
pnpm install
pnpm -r test        # core（fake index 换 sqlite 仍绿）+ lexical-sqlite（真实 in-memory FTS5）+ claim-flash 解析
pnpm -r typecheck
pnpm -r build
```

## v1 未实现（已留接口，不做 P6/P7）

- Elasticsearch `LexicalIndex` Provider（`packages/lexical-elasticsearch/`）
- 云向量 `VectorIndex` Provider + 查询期 embedding（`packages/vector-cloud/`）
- Cursor hooks / CLI（`packages/cli/`、`packages/cursor-hooks/`）
- 领域抽取器 `java-symbols` / `office-names` / `media-caption`（`packages/extractors/`）

## 对照计划书验收（§14 完成定义）

1. 同一 `.dsh/flywheel/index.sqlite` 可被 CLI / DSH / Cursor hook 读写 —— core 不绑 sqlite，`lexical-sqlite` 是唯一读写该文件的 Provider。
2. 换题后工作集卡片跟着变、不出现上一题 superseded 卡 —— 见 `core/retrieve.ts` + `flywheel-window`。
3. 「生成 Q3 预算 PPT」在落盘 / 用途句后，新会话可 FTS 到 artifact/claim —— 见 `flywheel-index`。
4. 其它会话原文默认不进自动注入，`session_search` 能搜到标题 —— 见 `retrieve` 的 foreign-session 截断 + `tool-flywheel`。
5. 开局 `coding-search`（bash + 检索 + `/plan` + 受限 web）+ 12k spill；换窗在 step 1 先 `forced` 再回退 `context-overflow`，`compactNow` 仅 idle —— preset 在 `~/.dsh/.agent-presets/coding-search/`。
6. 财务 / 人力零额外抽取器也能靠 claim 工作 —— `generic` 抽取器内置。
7. 设置页出现「会话飞轮」卡片、改「注入字数上限」下一轮生效 —— 见 `dsh-bundle` client + store。
8. v1 未装 ES / 云向量时保存失败、sqlite 检索不受损 —— 见 store `validate`。
