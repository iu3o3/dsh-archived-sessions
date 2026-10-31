# dsh-archived-sessions

给 DeepSeek Harness Web GUI 加一个「归档会话」设置页：列出所有已归档的对话，并提供逐条删除和「全部删除」。

DSH 只有归档、没有删除；归档集合保存在宿主的工作区注册表里，会话本身是 `~/.dsh/sessions/<工作区>/session-<id>/` 目录。这个插件补上了删除能力。

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主侧 Cordis 插件。注册 `/dsh-archived-sessions/list` 与 `/delete` 两条受浏览器信任 fence 保护的 POST 路由。 |
| `lib/client.js` | 浏览器侧 bundle（手写 `window.__ModuleLoader__` 包装，无需构建）。注册 `settings.section` 页面。 |
| `cordis.patch.yml` | 打包成 bundle 时用的 insert 行（走 `dsh.profile.bundles` 渠道时需要）。 |
| `package.json` | `dsh.client.platform = web`，`exports["./client"]` 指向浏览器 bundle。 |

## 安装

### 用户安装（发布后）

在 DSH 里打开 **Plugins → Discover** 搜索 `archived sessions`，或者：

```bash
dsh plugin --profile desktop add dsh-archived-sessions
```

安装完重启 DSH，设置里会出现「归档会话」页；已归档对话的「…」菜单里也会多一条
「删除归档会话」。

> 如果你之前按下面的「开发时安装」手动加过挂载行，先把它删掉再走这条路径——同一个 id
> 被 bundle 和手动行各插一次，插件树会在启动时整体失败。

### 开发时安装（源码直接挂载）

工作区里直接跑 `install.sh`：复制到 `~/.dsh/profiles/desktop/node_modules/dsh-archived-sessions/`，并在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾补一段挂载行：

```yaml
- insert:
    - id: archived-sessions
      name: 'dsh-archived-sessions'
```

要点：

- **必须是 `insert:` 形式**。裸的 `- id: x / name: y` 在 patch 层只是「按 id 覆盖已有行」，插不进新插件——这一条踩过一次。
- profile 的 `cordis.patch.yml` 有文件监听，保存后约 1 秒重新组合 Loader，**不用重启应用**；浏览器半边跟着模块图下发，必要时 Ctrl+R 刷新页面。
- 不要同时把包加进 profile `package.json` 的 `dsh.profile.bundles`：bundle 补丁会插入同一个 id，两个同名 insert 会让插件树在启动时整体失败。

截图占位：`docs/screenshot.png`（设置页 + 菜单行），发布到商店前补上。

## 开发笔记（DSH 插件机制）

- 宿主侧就是普通 Cordis 插件：ESM 导出 `name` / `inject` / `apply(ctx)`，`inject` 里写服务名（如 `workspaceRegistry` 是 `super(ctx, "workspaceRegistry")` 注册的）。
- 浏览器侧是「模块加载器」格式，不是 ESM：`window.__ModuleLoader__.load({ id, factory })`，factory 返回 `module.exports` 并挂 `apply` / `inject`。`require('react')` 来自平台共享模块表，无需构建工具。
- 客户端服务：`ctx.sessions.list.getSnapshot().byId[id]` 有 title/cwd；`ctx.workspaces` 有 `archiveSession` / `unarchiveSession`。
- 会话目录 `~/.dsh/sessions/<编码工作区>/session-<id>/session.v4.jsonl.zstd`（zstd）。DSH 本身没有「删除会话」能力。
- 读 `app.asar`：工作区 `tools/asar.mjs`（`ls` / `cat` / `x` 子命令），文件头 16 字节之后是 JSON 头，数据基址 = `8 + u32@4`。

## 删除做了什么

一次删除按这个顺序走（顺序是踩出来的，别随手改）：

1. **`detachLive`** —— 宿主若仍持有这条会话（刚用过/刚归档的“热会话”会带持久化写入句柄），先把它从 `ctx.sessions` 里分离。不分离的话，查询索引会把活会话重新加回来，行永远删不掉。
2. **删目录** —— `~/.dsh/sessions/*/session-<id>/`，id 兼容 `session-<uuid>` 和裸 uuid 两种形态（侧边栏传的是前者，早期代码多拼了一次 `session-`，导致“只取消归档不删文件”）。
3. **清投影缓存** —— `~/.dsh/storages/session_projcache/sessions/session-<id>.json`。
4. **`unarchiveSession`** —— 移出归档集合，避免留下归档幽灵。
5. **`reindex`** —— 重读存储头、重建 registry 实体缓存。
6. **`reconcileQueryIndex`** —— 走公开的 `sessionQuery.listSessions()`，让它开库并对账，把被删会话从侧边栏真正依赖的 SQLite 索引里清掉。

任一步失败都不会中断整体，全部写进 `~/.dsh/archived-sessions.log`（每行一条 JSON），排查时先看这个文件。

**为什么“冷会话”能立即消失而“热会话”不行**：列表来自 `sessionQuery.listSessions()`，索引里包含 live 会话；热会话的写入句柄让 `persistence.list()` 继续报告它，索引就把它当活会话留着。分离之后索引才认账。

## 侧边栏菜单里的「删除归档会话」

除了设置页，已归档会话的「…」菜单里也会多一条红色的 **删除归档会话**，就在「取消归档」下面（slot `sidebar.workspaces.session.menu.item`，`order: 410`，内建 archive 是 400）。

- 这项注册的是列表 slot，宿主渲染时传 `{ sessionId, displayTitle }`；组件用 `ctx.workspaces.list` 订阅 `archivedSessionIds`，目标会话不在归档集合里就直接返回 `null`，所以普通会话的菜单看不到它。
- 删除成功后归档集合变化 → 该行随菜单一起卸载，不需要手动关菜单。
- 菜单行没有复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MenuItemButton`（那个模块不在本插件的解析范围），而是用一个同尺寸/同圆角/同 hover token 的普通按钮，颜色走危险红。
- 行首图标复用设置页那个「归档盒 + ×」：同一个 `NAV_ICON_SVG` 做成 mask，`background: currentColor` 所以自动变红，尺寸 14px。
- 测试脚本：`node scripts/smoke-client.mjs`（stub 掉 React/DOM/MutationObserver，验证两个 slot 的注册和「只为归档行渲染」）。

## 设置导航图标

`settings.section` 的注册契约只投影 `id` / `order` / `label`，图标由设置壳从内置 id 列表里挑，第三方 section 只能拿到默认齿轮。所以插件自己补：

1. `installNavIcon()` 用 `MutationObserver` 找 `[role="dialog"] nav button` 里文字等于 `归档会话` 的那一行，打上 `data-dsh-archived-sessions-nav`；
2. 注入一条样式：隐藏该行自带的 `> svg:first-child`，用 `::before` + `mask` 画出归档盒 + ×（`currentColor`，跟随主题/选中态）；
3. 卸载时移除标记和样式节点，HMR 安全。

要换图标改 `lib/client.js` 里的 `NAV_ICON_SVG` 常量即可（24×24、stroke 画法，会被转成 mask，颜色不参与）。

## 已知限制

- 只处理归档会话；正在运行的会话不会出现在列表里。
- 会话搜索索引（sqlite）要等宿主下次重建才会彻底消失。
- 没有做 `~/.dsh/storages` 里的会话级 KV 清理。
- 如果设置里手动切换插件（Plugin manager 会重写 `cordis.patch.yml`），需要确认这段挂载行还在。
