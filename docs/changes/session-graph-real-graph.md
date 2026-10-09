# 让会话图变成"真图"：方案

状态：P0+P1+P2 已实施（代码 + 测试 + 产物就绪），待重启 DSH host 与刷新页面做线上验收。

## 目标

让「会话图」tab 展示**项目产物图的真实结构**（节点 + 边 + 状态），而不是"当前会话日志的投影"：
以本会话为根，能看到它产出的 artifact/change、它引用过的文件、以及这些节点之间的
PRODUCED / CITES / DESCRIBES / SUPERSEDES 关系与 superseded 状态。

## 非目标

- 不做通用图浏览器（不支持任意节点为根的自由漫游、不做全项目全局图）。
- 不改检索算法（`core/retrieve.ts`）与注入行为；会话图始终是只读观测面。
- 不引入新的可视化依赖（d3/cytoscape 等）；用 SVG 手写布局，避免 client bundle 膨胀。

## 现状事实（本仓库 + 本机 DSH 检出核对）

1. **客户端图不读数据库的边**：`SessionGraphView` 的数据来自
   `client/graph-definition.ts` 对**会话事件**的 fold（`user/message`、`tool/call`），
   `GraphSnapshot` 只有 workingSet/produced/opened 三个列表，没有任何边。
2. **数据库里的边几乎没有**：写入点只有两处 ——
   `indexer.ts` 的 `sess → PRODUCED → art`，`claim-flash-run.ts` 的 `clm → DESCRIBES → art`。
   本机实测项目索引 `edges` 表在修复前是 0 行，修复后仅 1 行 PRODUCED。
   `IN_PROJECT`、`CITES`、`CONTINUES`、`PART_OF` **从未被写入**；`SUPERSEDES`
   在 `supersedeRecent` 里只翻 `status`，不写边。
3. **官方推荐的做法与现实现不同**：DSH 检出内文档（`app.asar` 内
   `/deepseek-ai-dsh-*/...` 插件作者指南）明确写道——
   > When the Client needs a value derived from a session, declare `wire.view` on the Host
   > projection. The value reaches the Client already computed; the Client does not fold
   > session events itself.

   即：Host 侧注册 session projection，客户端只读投影。当前实现（客户端 fold）正是文档不推荐的做法。
4. **可用的 Host 投影机制**：Host 服务 `sessionProjections`（`SessionProjectionRegistry`），
   `ctx.inject(['sessionProjections'], ctx => ctx.sessionProjections.register(definition))`；
   definition 形如 `{ key, stateSchema, stateVersion, init(header, inheritedEventCount), apply(state, event), wire: { viewSchema, view(state) } }`。
   客户端侧存在 `useProjection` 解析路径，业务组件通过 slot props 的 selector hooks 读取。
5. **一个重要约束**：`wire.view` 必须**同步**返回且引用稳定（registry 用 `Object.is` 比较；
   异步 view 返回 Promise 会直接 `viewSchema.parse` 失败）。图查询是 async，因此不能把
   sqlite 查询放进 `view`。

## 建议的路线（三步，按依赖排序）

### P0 先把边补上（数据层；不做这步，任何可视化都是森林）

| 边 | 写入点 | 说明 |
|---|---|---|
| `sess → IN_PROJECT → proj` | `indexer.ts` 的 `agent/created` | 与现有 project/session 节点同批写 |
| `art/chg → IN_PROJECT → proj` | `ingestWrittenPath` | 与 `PRODUCED` 同批写 |
| `sess → CITES → art` | `indexer.ts` 新增 `read` 类工具处理 | 读类工具（`read`/`grep`/`glob`）命中**已存在**的 artifact 时写；先 `getNode` 判存在，避免悬空边 |
| `chg(new) → SUPERSEDES → chg(old)` | `ingestWrittenPath` 的 change 分支 | 同项目上一个 active change 被新方案文件取代；这才是"改口径"的真实关系 |
| `sess(new) → CONTINUES → sess(old)` | `agent/created` | 需要会话的 fork/parent 信息，实现前先核对 session header 字段；拿不到就跳过 |

改哪些文件：`packages/dsh-bundle/src/indexer.ts`（主）、`packages/core/src/ids.ts`（如需稳定边 id）。
验收：一个会话里 write 一个 `.md` + read 两个已索引文件，`edges` 表出现 `IN_PROJECT`、`PRODUCED`、`CITES` 三类边，方向与 rel 正确。

### P1 把 fold 搬到 Host，改用官方投影（架构对齐）

- 新增 `packages/dsh-bundle/src/projection.ts`：注册 key 为 `flywheelGraph` 的 session projection。
  - `init/apply`：把现有 `client/graph-fold.ts` 的 fold 逻辑移到 host 侧（纯函数可复用，测试同步迁移）。
  - `wire.view`：**同步**返回已算好的快照（投影 state 本身），不做 IO。
- 客户端 `client/graph-definition.ts` 里的 `events.register` / `views.register` 删除；
  `SessionGraphView` 改为通过 slot props 的 projection selector hook 读取。
  实施第一步需在 DSH 客户端类型里确认该 hook 的确切名字与签名（本方案只确证存在，未确证拼写）。
- 验收：`pnpm -r test` 全绿；GUI 里会话图内容与改动前一致（回归），且不再有客户端 fold。

### P2 渲染真实图（子图 + 边 + 交互）

- 扩展 seam：`GraphStore` 增加子图查询（`edgesTo(ids, rels)` 或 `subgraph(rootIds, rels, depth)`），
  `lexical-sqlite` 实现之（现有只有 `neighbors` / `edgesFrom`）。
- Host 侧在 `tools/result`、`agent/created`、`session/event` 后**刷新缓存**（不是查询时算），
  投影 view 只读缓存 —— 这是绕开「view 必须同步」约束的关键设计。
- 投影 view 结构升级为：
  `{ nodes: [{ id, type, title, path, status, sessionId }], edges: [{ src, rel, dst }], stats }`，
  以本会话节点为根取 1 跳（可配置 2 跳）。
- 客户端渲染：SVG 分层图，session 居中、邻居按 rel 分组（产出 / 引用 / 依赖 / 取代）；
  `superseded` 节点灰显并标注被谁取代；节点点击展开卡片详情，能拿到 DSH 的 open-in-app
  能力就提供"打开文件"，否则退化为复制路径。

改哪些文件：`packages/core/src/seams.ts`、`packages/lexical-sqlite/src/index.ts`、
`packages/dsh-bundle/src/projection.ts`、`packages/dsh-bundle/src/client/SessionGraphView.tsx`
（+ 新的 SVG 组件与 CSS）。
验收：上述 P0 场景下，会话图显示 session→artifact/change 的连线与 superseded 灰显；
刷新页面数据一致；`pnpm -r test` / `typecheck` 全绿。

## 风险与备选

- **`sessionProjections` 是否对仓外 bundle 开放**未实测。若 `ctx.inject(['sessionProjections'])`
  在第三方 bundle 里取不到服务，退路是：host 注册一个自己的 cordis 服务，客户端经 `ctx.remote`
  命名空间调用（客户端插件 `inject` 里已可见 `remote` 这一模式的先例）。
- **P2 的缓存一致性**：缓存刷新与 view 读取必须同一 tick 语义内一致，否则会出现"图落后一轮"。
  备选：投影 view 只暴露 seq 与节点 id 列表，客户端再按 id 拉详情（仍需 remote）。
- 若只想拿最小收益：只做 P0 + 在现有三列表上增加状态标注（superseded 灰显、来源会话标记），
  不动架构。

## 建议

先做 P0（小、纯收益、为后面铺路），再做 P1（对齐官方、消掉客户端 fold），P2 视需要投入。

## 实施记录（P0 + P1 + P2）

### P0 边（`packages/dsh-bundle/src/indexer.ts`）

- `sess → IN_PROJECT → proj`：`agent/created` 写会话节点时同批写。
- `art/chg → IN_PROJECT → proj`：写文件时同批写；artifact 的 `PRODUCED` 边不再用空
  session id 兜底（少了悬空边）。
- `sess → CITES → art`：`read` 类工具结果命中**已索引** artifact 时才写（先 `getNode` 判断）。
- `sess → SUPERSEDES → node`：纠正句触发 `supersedeRecent` 时，除翻 `status` 外记录是谁作废的。
- `CONTINUES` 未做：会话 header 里没有稳定的 fork/parent 字段，做了会是假边。
- 新增 `linkEdges()` 统一走 `GraphStore.upsertEdge`（id 仍为 `src:rel:dst`，重复写幂等）。

### P1 Host 投影（`src/projection.ts` + `src/graph-key.ts`）

- 新增插件行 `flywheel-graph-projection`（`@dsh-flywheel/dsh-bundle/projection`，
  `inject: ['sessionProjections']`）：服务不存在时该行不激活，不影响其它插件。
- `fold` 从 `src/client/` 移到 `src/graph-fold.ts`（host 构建排除 `src/client`，否则 host 用不到）。
- 投影 definition：`key: 'flywheelGraph'`、`stateVersion: 1`、`init/apply` 同步 fold，
  `wire.view` 返回**存在 state 里的同一个引用**（registry 用 `Object.is` 比较，
  现算会每次发布）。
- 客户端 `SessionGraphView`：有 `useProjection` 时读投影，读不到或为空时**回退**到原来的
  客户端 fold 渲染（`graph-definition.ts` 保留），因此投影不可用时不会退化成空白。

### P2 真图渲染

- `src/graph-view.ts`（纯函数，可测）：把 fold 结果投影成 `{ nodes, edges, counts }`，
  节点 kind = `session | produced | opened | card`，边 rel = `produced | opened | injected`；
  同一路径同时被写和读时只画一个节点、保留两条边。
- `src/graph-layout.ts`（纯函数，可测）：四列布局（session / produced / opened / card），
  每列上限 14 个节点并报告溢出数，边为三次贝塞尔路径。
- 客户端用 SVG 画布局结果：连线上色区分关系、图例带计数、节点点击显示详情、
  有路径时提供「复制路径」（`navigator.clipboard`）。
- 旧的列表视图保留为回退渲染。

### 验收

- `pnpm -r test`：core 14 / lexical-sqlite 9 / dsh-bundle 97，全绿（新增 `projection.spec.ts`、
  `graph-layout.spec.ts`，`indexer.spec.ts` 扩到 11 例覆盖四类边）。
- `pnpm -r typecheck`：3 包通过；`pnpm -r build` + `bundle` 产出 `lib/projection.js`、
  `lib/graph-view.js`、`lib/graph-layout.js`、`lib/client.js`（66.6 kB，不含 schemastery）。
- 待线上验收（需重启 DSH host：新插件行 + host 代码；并刷新页面加载新 client bundle）：
  1. 会话图出现连线与图例计数；
  2. 点击节点显示详情并可复制路径；
  3. 若 shell 不提供投影 hook，界面与改动前一致（回退路径）。

### 仍未做到（诚实边界）

- **投影数据仍来自会话事件 fold，不是 sqlite 里的项目图**。原因是 `wire.view` 必须同步返回，
  而库查询是异步的；把库查询结果接进投影需要"事件后刷缓存 + view 读缓存"的额外机制
  （见「风险与备选」第二条），本轮未做。
- 因此 `superseded` 灰显、跨会话节点、`DESCRIBES/CONTINUES` 等关系还不会出现在视图里，
  尽管 P0 已经开始把这些边写进数据库，为下一步铺路。
