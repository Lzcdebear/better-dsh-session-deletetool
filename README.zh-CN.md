# dsh-session-delete

**真正删除 DeepSeek Harness 里的会话 —— DSH 自带的能力只有归档。**

[English](README.md)

---

## 为什么需要它

DSH 只能**归档**会话：归档把那一行从侧边栏隐藏，工件一样不动，日志、工程记录、投影缓存都留在磁盘上，随时可以恢复。持久化接口本身根本没有删除能力，`@deepseek-ai/dsh-session-persistence-jsonl` 写得很直白：

> **Nothing deletes session files** —— 日志在 `root` 下不断堆积，直到被外部删除；这一层没有删除接口。

于是用得越久，会话只增不减。这个插件补上缺失的那一步：在会话的 `⋯` 菜单里加一项**删除会话**，真的把数据抹掉。

## 删了什么

对选中的会话，宿主半会：

1. **删掉会话工件目录** —— 当前日志、保留的每一代历史格式、以及目录里的会话本地文件（路径由 `ctx.sessionPersistence.locate(header)` 给出）；
2. **删掉它的子会话** —— 子智能体是各自独立的 session，各有各的日志。整棵子树取自持久化的 `subagentCatalog` 投影（`ctx.subagents.listDescendants`），**从最深的往下删**。子树在动手之前先收集完，超过 200 个就整体中止、什么都不删；
3. **摘掉工程记录** —— 该 id 从每个 Workspace 记录的 `sessionIds` 里移除（`Workspace.detachSession`），并从注册表全局的归档集合、置顶集合里移除；
4. **删掉投影缓存** —— `session_projcache` 域里的记录和磁盘上对应的 `<id>.json`；
5. **通知页面** —— 每个被删的 id 各发一次 `api-session/removed`，这是官方会话控制器销毁会话时发的同一个事件，侧边栏的行会立刻消失。

分叉（fork）出来的会话**不会被动**：fork 是独立 session，不在子智能体名册里，删原会话不会带走它。

### 什么会拦，什么不会

**只有"还有工作在跑"会拦，"还开着"不会。** 门槛用的是 DSH 自己归档时的那条 `workspace/session-activity` 瀑布：Agent 注册表报进行中的回合，后台任务注册表报后台任务，子智能体运行时报运行中的子会话，定时提醒报生效中的任务。确认框会写明还剩什么在跑，并提供**停止并删除**，先派发 `workspace/session-stop`——和 `archiveSession(id, { stopActivity: true })` 完全一致。

宿主内存里还持有这个会话（`ctx.sessions` / `ctx.agents`）时照样删。本机实测（Windows）：文件句柄还开着时 `rm` 依然成功，目录项立刻消失，之后的写入落进已删除的文件而不是把它复活。早先的版本会拒绝这种会话并提示"先切换到别的会话"，结果把没显示在窗口里的会话也一起误伤了，那条规则已经去掉。

### 已知边界

- **附件二进制不删。** 上传的图片和文件存在 `~/.dsh/attachments/v1/objects/<hash>`，是内容寻址的去重仓库、多个会话共享，服务本身没有引用计数，所以这些 blob 会留下。
- **搜索索引会自己收拾。** `dsh-session-query-sqlite` 是派生索引，每次检索前都会跟持久化对账，被删掉的源从下一次检索起就查不到了。
- **会话仍被占用时可能留下一条死缓存。** 删除时宿主还持有它的话，它被销毁的那一刻投影缓存可能再写回一条 checkpoint。那条记录永远读不到（没有日志就没有会话），只是几十 KB 的死文件。
- **改插件代码要重启 DSH。** 如果 profile 的 HMR 不监视模块文件，替换已安装包里的代码需要重启；客户端那一半刷新页面即可。

## 安装

下面几条都走 DSH 自带的插件管理，它接受一个安装 spec（`@deepseek-ai/dsh-plugin-manager`）：registry 包名、git 主机简写、仓库 URL、tarball，或者本地绝对路径。按你的网络情况挑一条。

### 1. 直接从 GitHub 装（需要能访问 github.com）

spec：

```
github:Lzcdebear/dsh-delete-session
```

等价写法：

```
https://github.com/Lzcdebear/dsh-delete-session
```

把 spec 交给 DSH：

- **在应用里**：设置 → 插件 → 安装入口，粘贴 spec。（插件管理界面和 `plugin_manager` 工具接受的是同一个字符串。）
- **在会话里**：让 Agent 装 —— 工具调用是 `plugin_manager`，`action: "install_bundle"`，`target: "github:Lzcdebear/dsh-delete-session"`。

可以用 `#` 钉住某个 ref：`github:Lzcdebear/dsh-delete-session#v0.1.0`。

连接检查失败时 DSH 会给出一个有界的日志路径。如果这台机器根本连不上 github.com，走第 2 或第 3 条，或者先给 git 配上代理（`git config --global http.proxy http://127.0.0.1:7890`）。

### 2. 从本地副本装（离线可用）

把仓库下载下来（ZIP 或 `git clone`），解压到任意位置，然后把**绝对目录**交给插件管理：

```
plugin_manager { action: "install_bundle", target: "D:\\plugins\\dsh-delete-session" }
```

DSH 会记一条 `link:` 依赖并重载 profile。开发这个插件用的就是这条路，网络受限时也走它。

### 3. 从发布 tarball 装

```
https://github.com/Lzcdebear/dsh-delete-session/archive/refs/heads/main.tar.gz
```

安装入口同第 1 条；git 不可用但 HTTPS 通的时候好用。

### 装完之后

宿主半随 profile 一起加载；客户端半刷新页面后出现。会话的 `⋯` 菜单里会多一项**删除会话 / Delete conversation**。

想卸载就用同一个管理入口：`plugin_manager { action: "remove_bundle", target: "dsh-session-delete" }`（bundle 键就是包名）。

## 用法

1. 在任意会话行上点 `⋯`，选**删除会话**。
2. 确认框先向宿主问一次真实状态，然后写清楚：会删掉什么、它是不是还被 Harness 占用、还剩什么在工作、会连带删掉几个子会话。
3. 确认。如果还有在跑的工作，按钮会变成**停止并删除**，按下去先停掉那些工作。
4. 那一行立刻从侧边栏消失，数据也从磁盘上没了。

## HTTP 接口

客户端半通过 `ctx.webServer` 上两条同源 `exact` 路由访问宿主。纯 JS、无构建步骤的插件没法声明带类型的 `ctx.remote` 命名空间（那需要 Typert 生成产物），所以这里用的是社区插件 `dshmarket` 同款通道。

| 路由 | 方法 | 作用 |
|---|---|---|
| `/dsh-session-delete/inspect?sessionId=…` | GET | 返回 `stored` / `open` / `agent` / `running` / `activity` / `artifactDirectory` / `descendants`（`{ count, ids }`） |
| `/dsh-session-delete/delete` | POST | body `{ sessionId, stop? }`；返回 `removed`、`descendants`、`stoppedActivity`、`runtime`、`activity` |

两条路由各自带同源校验：`Host` 必须是环回、`sec-fetch-site` 不能是 `cross-site`、`Origin` 存在时必须与 `Host` 同源。别的网站页面打不进来。

## 构成

| 文件 | 作用 |
|---|---|
| `host.js` | 宿主半：两条路由、工件/工程记录/缓存清理、子会话子树 |
| `client.js` | 客户端半：`sidebar.workspaces.session.menu.item` 菜单项（order 500）+ `shell.overlay` 确认框 |
| `cordis.patch.yml` | 把宿主行插进 profile 层栈 |
| `test/host.test.mjs` | 路由测试，跑在真实临时目录上 |
| `icon.svg` | 插件图标 |

样式只用宿主主题 token（`--dsw-alias-*`），浅色深色都跟随；界面文案通过客户端 locale 服务本地化（英文 / 简体中文）。

## 开发

```sh
node --test test/host.test.mjs
```

测试直接驱动真实的 `apply()` 注册，配假的宿主服务和真实的临时目录，覆盖：删除本体、有活时的拦截与停止、子会话子树、状态查询，以及各种拒绝路径（坏 id、坏 body、错方法、跨站来源）。

## 许可

[MIT](LICENSE)
