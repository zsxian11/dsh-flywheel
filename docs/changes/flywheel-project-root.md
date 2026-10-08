# 飞轮项目根：从 session 工作区解析（桌面版修复）

## 目标

让 `@dsh-flywheel/dsh-bundle` 在 DSH 桌面版（Electron）下也按**当前会话的工作区**定位项目根，
从而把 `.dsh/flywheel/index.sqlite` 落到项目里、`projectId` 有意义。

## 问题（实测，DSH 0.2.0-rc.2）

桌面版宿主进程的 cwd 是 profile 目录，不是工作区。两处后果：

1. **项目根解析错**。`project.ts` 用 `process.cwd()`，于是桌面版下
   `projectRoot()` = `~/.dsh/profiles/desktop`、`projectId` = 字面量 `"desktop"`，
   DB 落到 `~/.dsh/profiles/desktop/.dsh/flywheel/index.sqlite`，所有工作区共用一份索引。
   实测证据：本会话写 `docs/changes/flywheel-project-root.md` 时，运行中的宿主写入的两条
   节点 `project_id` 都是 `"desktop"`。

2. **会话起点事件名过期**。`indexer.ts` 监听 `agent/session-start`；该名字在已安装的
   DSH 里出现 **0 次**，而 `agent/created` 出现 43 次。DSH 0.2 把 agent 事件改名了，
   监听器于是不再触发，project / session 节点停止写入。
   （仓库 `.dsh/flywheel/index.sqlite` 里 2026-09-14 那 7 条 `project_id: "dsh-flywheel"`
   的节点，是 0.1.x 时代同一个监听器写下的 —— 改名后就没再有过。）

会话工作区是可得的：session 存储头里带绝对 `cwd`（`session.header.cwd`），与
`~/.dsh/sessions/--Users-…-dsh-flywheel--/` 目录名一致。

## 范围

- `projectRoot()` / `projectId()` 按 session 的 `header.cwd` 解析，`DSH_FLYWHEEL_ROOT` 仍是最高优先覆盖。
- 所有调用点传入当前 session（indexer / inject / tools / lexical-sqlite）。
- `flywheel-index` 的会话起点监听改为 `agent/created`。
- `flywheel-lexical-sqlite` 在项目根变化时关闭旧 store、挂载新 store。
- `dsh-shims.d.ts` / `cordis-augment.d.ts` 两个本地构建桩补上真实契约
  （`Session.header`、`defineTool` 的 `(args, exec)`、`agent/created`）。

## 非目标

- 不改 `@dsh-flywheel/core` 的检索协议（seam 方法签名不动）。
- 不做多项目并发路由（见「已知限制」）。

## 要改的文件

| 文件 | 改动 |
|---|---|
| `packages/dsh-bundle/src/project.ts` | `SessionWorkspace` 形状；session cwd 解析 |
| `packages/dsh-bundle/src/lexical-sqlite.ts` | 按根挂载 / 换根重挂 |
| `packages/dsh-bundle/src/indexer.ts` | `agent/session-start` → `agent/created`；`projectId(session)` |
| `packages/dsh-bundle/src/inject.ts` | `projectId(agent.session)` |
| `packages/dsh-bundle/src/tools.ts` | `execute(args, exec)`；`projectId(exec.agent?.session)` |
| `packages/dsh-bundle/src/dsh-shims.d.ts` | `Session.header`、`ToolExecContext` |
| `packages/dsh-bundle/src/cordis-augment.d.ts` | 事件表换名 |
| `packages/dsh-bundle/tests/project.spec.ts` | 新增 5 例 |

## 实现中发现并修掉的第二个 bug

换根时先 `register` 新 store、后 `dispose` 旧 store 是错的：registry 的 disposer 按
backend id 无条件删除（`service.ts` 的 `registerLexical` 返回 `() => state.lexical.delete(index.id)`），
新旧的 id 都是 `sqlite-fts`，所以「先注册后释放」会把刚挂上的新 store 删掉，
`ingest` 直接 `BackendNotMountedError`。现在改为**先打开、再释放旧、最后注册新**：
打开失败时保留旧挂载，成功时不会误删。

## 已知限制

- **一个宿主同时一个项目根**。换根只发生在 `agent/created`（不是每轮），单工作区使用无感；
  但两个不同工作区的会话同时在跑时，后创建的 agent 决定当前 DB，另一个会话的写入会落错库。
  彻底解决需要给 core 的 graph seam 补项目上下文（P 系列），不在本次范围。
- profile 目录下仍会在插件 `apply` 时先建一个空的
  `~/.dsh/profiles/desktop/.dsh/flywheel/index.sqlite`（eager mount 保证设置页校验
  `lexicalBackend` 已挂载前不误报），首个会话建立后即被关闭并弃用。

## 验收

1. `pnpm -r typecheck` 全绿。
2. 新增单测 5 例（解析优先级 + `agent/created` 订阅 + 节点 project_id）通过。
3. `@dsh-flywheel/core` 14 例、`@dsh-flywheel/dsh-bundle` 58 例全绿。
4. 脱离 app 的端到端脚本（宿主 cwd = profile 目录、会话 cwd = 工作区）验证：
   订阅的是 `agent/created`、DB 落在工作区、`ingest` 写入工作区 DB 且
   `project_id` = 工作区目录名。
5. 已知不达标项：`packages/lexical-sqlite` 的 `tests/store.spec.ts` **改动前后同样失败**，
   根因是 Node 至今（含 24.21）不在 `module.builtinModules` 里列 `sqlite`，
   Vite 5.4 因此剥掉 `node:` 前缀并去找名为 `sqlite` 的包。Vitest 2.1 只在 module runner
   里特判了 `node:sqlite`，挡不住 Vite 的 transform 阶段。
   `test.server.deps.external` / `--config` 显式指定均已试过，无效。
   与本次改动无关，未修。
