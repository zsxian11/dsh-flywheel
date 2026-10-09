# 会话图（flywheel-graph）一直无数据：排查结论与修复

状态：已实施（代码 + 测试 + 产物重建），待重启 host 后验收线上效果。

## 目标

查明 Web GUI「会话图」tab 始终为空的原因（数据链路：host 注入 → 索引 → 客户端 fold → 视图），
修掉链路中的断点。

## 非目标

- 不改检索算法骨架（`packages/core/src/retrieve.ts` 的召回→1 跳→渲染流程不变）。
- 不覆盖 `bash` 等非文件工具的引用（属既有设计取舍）。
- 不在本轮为 artifact / change 节点补正文（见「已知限制」）。

## 排查结论

### 事实证据

1. host 侧索引链路是好的：写入 `docs/changes/session-graph-no-data.md` 后，
   `.dsh/flywheel/index.sqlite` 立刻新增 `artifact` + `change` 节点与一条 `PRODUCED` 边。
2. 客户端 fold 只认两类事件：`user/message`（flywheel-inject 注入的工作集）和 `tool/call`（文件引用）。
3. DSH 的会话事件里 `tool/call.data.arguments` 是 **JSON 字符串**：
   - 类型声明（app.asar 内）：`'tool/call': { turn; step; callId; name: string; arguments: string }`
   - 真实会话日志（`~/.dsh/sessions/**/session.v4.jsonl.zstd`）逐条核对，全部为 `str`。
4. 所有会话日志中 `source.plugin === 'flywheel-inject'` 的 `user/message` 记录数为 **0**，即 host 从未注入。
5. 词法检索把用户整句直接当 FTS5 MATCH 查询，未分词、未转义：中文整句被 unicode61 当作单一
   token（召回 0），含 `-` 等符号还会抛 `no such column: graph` 一类语法错误并被 `inject.ts`
   的 catch 吞掉。

### 根因

- **根因 A（produced / opened 恒空）**：`graph-fold.ts` 的 `fileFact` 把 `event.data.arguments`
  当对象传给 `pathFromToolArgs`，而它只接受对象 → 字符串一律 `undefined` → `fileFact` 恒为 `null`。
  原测试 fixture 用对象，掩盖了该 bug。
- **根因 B（working set 恒空）**：注入依赖检索召回；中文整句在 unicode61 FTS5 上恒 0 命中
  （并可能抛语法错误被吞），于是从不注入，客户端永远拿不到 `working-set` fact。

## 改动

1. `packages/dsh-bundle/src/paths.ts`
   - 新增 `toolArgsObject(args)`：对象直接用；JSON 文本 `JSON.parse`（失败返回 `undefined`）。
   - `pathFromToolArgs` 改为经它取值 → host 与 client 共用，两种形态都支持。
2. `packages/lexical-sqlite/src/index.ts`
   - `nodes_fts` 改用 `tokenize='trigram'`，schema 版本 1 → 2。
   - `applySchema` 增加 in-place 迁移：旧库 drop FTS 表与触发器 → 重建 → `rebuild` 回填；
     仅「磁盘版本高于本 build」才失败。
   - 新增 `ftsTerms` / `ftsMatch`：CJK 切 3-gram、拉丁整词，每个词加引号后 `OR` 连接，
     彻底消除 FTS 语法错误。
   - `search` 在 gram 查询无结果时回退 `LIKE` 子串召回（覆盖「预算」这类短查询）。
   - 新增 `fileNodesNeedingDigest(projectId, limit)`：列出 summary 仍为空的 active
     artifact/change 节点（回填用）。
3. `packages/dsh-bundle/src/digest.ts`（新）
   - `digestOfText`：取首个 markdown 标题为 title、首个正文段落为 summary（跳过代码围栏、
     去列表/强调标记、按 80/200 字符截断）。
   - `readFileDigest(root, path)`：只读文本类后缀（`.md/.markdown/.mdx/.txt/.text`）、
     只读文件头 8KB、拒绝项目根之外的路径，任何失败返回 `undefined`。
4. `packages/dsh-bundle/src/indexer.ts`
   - 两处 `tools/result` 监听合并为一处 `ingestWrittenPath`：一次读取文件头，
     artifact 与 change 都写入真实 `title`/`summary`（原来只有 basename、summary 为空）。
   - `agent/created` 时按项目根各跑一次 `backfillDigests`（上限 200 条），
     把历史卡片补上正文，重跑不再重复。
   - 行为变更：`docs/changes/**` 的 change 写入现在也受 `config.enabled` 约束（原先不受）。
5. 测试
   - `packages/dsh-bundle/tests/graph-fold.spec.ts`：新增「真实事件形态（arguments 为 JSON 文本）」
     与「非法 JSON 安全返回 null」用例。
   - `packages/dsh-bundle/tests/digest.spec.ts`（新）：纯函数解析（标题/段落/围栏/截断）
     与真实文件读取（越界路径、二进制后缀、缺失文件）。
   - `packages/dsh-bundle/tests/indexer.spec.ts`（新）：写入产生带正文的卡片、
     JSON 文本参数、二进制后缀保留 basename、关闭时/失败结果不写入、历史卡片回填。
   - `packages/lexical-sqlite/tests/store.spec.ts`：新增中文整句召回、含 `-` 查询不抛错、
     短查询 LIKE 兜底、待回填节点列举、v1 → v2 迁移用例。
   - `vitest.config.ts`：把 `node:sqlite` alias 到 `packages/lexical-sqlite/tests/node-sqlite-shim.ts`，
     修掉该包长期加载失败（vite 不认识实验性内置模块）。

## 验收

- `pnpm -r test`：core 14 / dsh-bundle 79 / lexical-sqlite 9，全绿。
- `pnpm -r typecheck`：3 个包全通过。
- `pnpm -r build` + `pnpm --filter @dsh-flywheel/dsh-bundle bundle`：`lib/client.js` 含 `toolArgsObject`，
  `lib/digest.js` 已产出。
- 真实库副本「迁移 + 回填 + 召回」端到端验证：v1 库（含 WAL）打开即迁移到
  `schema_version=2` / `tokenize='trigram'`；2 个旧卡片回填后剩余待回填数为 0；
  修复前中文整句召回为 `[]`，修复后命中这两个节点。
- 待线上验收（需重启 DSH host 使新 host 代码生效，并刷新 GUI 页面加载新 client bundle）：
  1. 会话图显示「本会话写出 / 读过」，计数不再为 0；
  2. 出现「本轮工作集」卡片。

## 已知限制

- `trigram` 查询少于 3 个字符时无法匹配，已由 `LIKE` 兜底覆盖。
- 回填每次宿主进程每个项目根只跑一次，上限 200 条；超出部分在后续会话再次触发。
- 卡片正文来自文件**头 8KB**：正文写在文件深处、或后缀不在文本白名单里的文件，
  卡片仍只有 basename。
