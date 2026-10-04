# better-dsh-session-deletetool

**真正删除 DeepSeek Harness 里的会话 —— DSH 自带的能力只有归档。**

[English](README.md)

---

## 为什么需要它

DSH 只能**归档**会话：归档把那一行从侧边栏隐藏，工件一样不动，日志、工程记录、投影缓存都留在磁盘上，随时可以恢复。持久化接口本身根本没有删除能力，`@deepseek-ai/dsh-session-persistence-jsonl` 写得很直白：

> **Nothing deletes session files** —— 日志在 `root` 下不断堆积，直到被外部删除；这一层没有删除接口。

于是用得越久，会话只增不减。这个插件补上缺失的那一步：在会话的 `⋯` 菜单里加一项**删除会话**，真的把数据抹掉；它弹出的确认框也是唯一能看清一个会话全家结构的地方。

## 删了什么

对选中的会话，宿主半会：

1. **删掉会话工件目录** —— 当前日志、保留的每一代历史格式、以及目录里的会话本地文件（路径由 `ctx.sessionPersistence.locate(header)` 给出）；
2. **删掉你勾选的子会话** —— 子会话是各自独立的 session，各有各的日志。DSH 把每个子会话的父 id 记在它自己的 header 里（`SessionHeader.parentSession`），而且它创建的每种关系都写这个字段：子智能体由运行时写入并带 `origin: 'subagent'`，fork 出来的对话写入并带 `isSeeded`，Agent Teams 的名册也靠同一个字段解析。插件按这条血缘广度优先遍历，再与持久化的 `subagentCatalog` 投影（`ctx.subagents.listDescendants`）取并集，因此连 header 已经读不出来的子会话也能被点名。删除**从最深的往下**，集合在动手之前先收集完，一次最多删 200 个，而且只删勾上的那些；
3. **摘掉工程记录** —— 每个 id 从每个 Workspace 记录的 `sessionIds` 里移除（`Workspace.detachSession`），并从注册表全局的归档集合、置顶集合里移除；
4. **删掉投影缓存** —— `session_projcache` 域里的记录和磁盘上对应的 `<id>.json`；
5. **关掉它拥有的终端** —— `ctx.terminals` 不属于任何一条准入族，服务要等 Agent 被释放才回收，而那时日志早就没了；
6. **通知页面** —— 每个被删的 id 各发一次 `api-session/removed`，这是官方会话控制器销毁会话时发的同一个事件，侧边栏的行会立刻消失。

### 看清家族，再选择删什么

侧边栏里，子智能体和派生对话都是各自独立的一行，看不出是谁生的，DSH 本身也没有任何地方画这条关系。这个确认框是唯一画出来的地方：整个家族画成**一棵树**，包括派生对话自己带出来的下一层。

- 第 1 行是**本对话**，它的勾选框管整个家族，名字跟侧边栏显示的一致；
- 第 2 行是一个**可折叠的「子智能体（n）」分支**，装本对话自己生的子智能体；
- 第 3 行是一个**可折叠的「派生对话（n）」分支**，分支里每个派生对话自带它自己的「子智能体（n）」子分支，所以**派生对话的派生对话画在父辈块里面**（缩进多一格），而不是跟它并排；
- 子智能体自己派生出来的对话，同理画在那个子智能体的块里面；
- 每行都有勾选框，标出名字和 id 尾号，还开着的或还有工作没跑完的会带状态标记；名字跟侧边栏同一套规则：日志里有名字用名字，没有就用它项目目录的末段，再没有才用 id，所以不会显示成"未命名"；
- 层级只靠**缩进**表达：一级缩进一格、二级两格，父行后面紧跟它自己画出来的子行，所以第 3 层那行一眼能看出是挂在上面第 2 层那行下面，而不是"反正更深一点"。

每行的勾选框管**它自己那棵子树**：下面全都勾上时它是勾上的，只勾了一部分时显示成半选，按一下整棵子树一起勾或一起取消；分组标题的勾选框管这个分组列出的所有行。删除集合只存这一份 id，不再有"选中的根 + 排除的子行"两套状态，所以底部的计数不会和画面对不上。

读不到的血缘会写在列表上方（比如某个分支的目录打不开），而不是静默少几行——少行和"这个会话确实没有子会话"原来长得一样。

确认时只提交勾上的 id，按钮上写着即将删掉几个会话。没勾的子会话会作为独立的会话根留下来。选择会在宿主侧拿它自己走出来的血缘做校验，请求只能点到这个家族里的会话。fork 出来的对话本身也是独立会话，所以它是"带勾选框列出来"，而不是被静默带走。

### 批量删除

工作区标题行、搜索图标**左边**多了一个垃圾桶图标（画的是 `deleting icon.svg` 那个图），点开是一个总览所有会话的弹窗：

- **按工作区分区。** 分区顺序跟注册表里工作区的顺序一致，标题是工作区名，右边写这个区里有几个会话；没有被任何工作区认领的会话归到最后一个**未归类**区。
- **每个会话画成和单会话确认框同一棵树**：会话行下面是它自己的「子智能体（n）」和「派生对话（n）」两个可折叠分组，派生对话再把自己那一层接在它自己的块里面，层级只靠缩进表达。
- **会话名跟侧边栏一致**：日志里有名字就用名字，没有就用它项目目录的末段（比如 `Project_lzc`），再没有才用 id。没改过名的会话因此显示成目录名，而不是"未命名"。
- **勾选按子树走，子会话可以单独删。** 勾上母会话，它下面勾中的子会话和派生对话跟着一起删；只勾某个子智能体、不勾它的母会话时，那个子智能体自己作为一个删除根提交，母会话保持不动。底部按钮始终写着这次会删掉几个会话。

弹窗里同样有「停止并删除」那个开关，默认打开，和单会话确认框一致。确认后每个被勾的会话根各自走一次上面那条删除流程；某个根失败只在弹窗里列出来，其余照删。

### 什么会拦，什么不会

**只有"还有工作在跑"会拦，"还开着"不会。** 门槛用的是 DSH 自己归档时的那条 `workspace/session-activity` 瀑布：Agent 注册表报进行中的回合，后台任务注册表报后台任务，子智能体运行时报运行中的子会话，定时提醒报生效中的任务。这个询问是**对删除集合里的每一个会话各问一次**，因为这条准入是按被问的会话作答的：只问目标的话，子会话正在跑的回合或后台任务根本不会出现。确认框会把还在跑的东西写在对应行上、也写在汇总里，并提供**停止并删除**——先对每个忙碌的会话派发一次 `workspace/session-stop`，和 `archiveSession(id, { stopActivity: true })` 完全一致。

宿主内存里还持有这个会话（`ctx.sessions` / `ctx.agents`）时照样删。本机实测（Windows）：文件句柄还开着时 `rm` 依然成功，目录项立刻消失，之后的写入落进已删除的文件而不是把它复活。早先的版本会拒绝这种会话并提示"先切换到别的会话"，结果把没显示在窗口里的会话也一起误伤了，那条规则已经去掉。

### 已知边界

- **附件二进制不删。** 上传的图片和文件存在 `~/.dsh/attachments/v1/objects/<hash>`，是内容寻址的去重仓库、多个会话共享，服务本身没有引用计数，所以这些 blob 会留下。
- **搜索索引会自己收拾。** `dsh-session-query-sqlite` 是派生索引，每次检索前都会跟持久化对账，被删掉的源从下一次检索起就查不到了。
- **会话仍被占用时可能留下一条死缓存。** 删除时宿主还持有它的话，它被销毁的那一刻投影缓存可能再写回一条 checkpoint。那条记录永远读不到（没有日志就没有会话），只是几十 KB 的死文件。
- **改插件代码要重启 DSH。** 如果 profile 的 HMR 不监视模块文件，替换已安装包里的代码需要重启；客户端那一半刷新页面即可。

## 安装

下面几条都走 DSH 自带的插件管理，它接受一个安装 spec（`@deepseek-ai/dsh-plugin-manager`）：registry 包名、git 主机简写、仓库 URL、tarball，或者本地绝对路径。npm 那条也可以直接用 `npm install` 装进 profile 目录。按你的网络情况挑一条。

### 1. 从 npm 装（包名 `better-dsh-session-deletetool`）

走 registry，也是唯一不需要访问 github.com 的：

```
npm install better-dsh-session-deletetool
```

DSH 自带的插件管理直接接受 registry 包名，在应用里走这条更省事，它会往 profile 记一条依赖并重载。

- **在应用里**：设置 → 插件 → 安装入口，粘贴 `better-dsh-session-deletetool`。
- **在会话里**：`plugin_manager { action: "install_bundle", target: "better-dsh-session-deletetool" }`。

要钉版本就照 npm 的写法：`better-dsh-session-deletetool@0.4.0`。

### 2. 直接从 GitHub 装（需要能访问 github.com）

spec：

```
github:Lzcdebear/better-dsh-session-deletetool
```

等价写法：

```
https://github.com/Lzcdebear/better-dsh-session-deletetool
```

把 spec 交给 DSH：

- **在应用里**：设置 → 插件 → 安装入口，粘贴 spec。（插件管理界面和 `plugin_manager` 工具接受的是同一个字符串。）
- **在会话里**：让 Agent 装 —— 工具调用是 `plugin_manager`，`action: "install_bundle"`，`target: "github:Lzcdebear/better-dsh-session-deletetool"`。

可以用 `#` 钉住某个 ref：`github:Lzcdebear/better-dsh-session-deletetool#v0.1.0`。

连接检查失败时 DSH 会给出一个有界的日志路径。如果这台机器根本连不上 github.com，走第 1、3 或第 4 条，或者先给 git 配上代理（`git config --global http.proxy http://127.0.0.1:7890`）。

### 3. 从本地副本装（离线可用）

把仓库下载下来（ZIP 或 `git clone`），解压到任意位置，然后把**绝对目录**交给插件管理：

```
plugin_manager { action: "install_bundle", target: "D:\\plugins\\better-dsh-session-deletetool" }
```

DSH 会记一条 `link:` 依赖并重载 profile。开发这个插件用的就是这条路，网络受限时也走它。

### 4. 从发布 tarball 装

```
https://github.com/Lzcdebear/better-dsh-session-deletetool/archive/refs/heads/main.tar.gz
```

安装入口同第 2 条；git 不可用但 HTTPS 通的时候好用。

### 装完之后

宿主半随 profile 一起加载；客户端半刷新页面后出现。会话的 `⋯` 菜单里会多一项**删除会话 / Delete conversation**。

想卸载就用同一个管理入口：`plugin_manager { action: "remove_bundle", target: "better-dsh-session-deletetool" }`（bundle 键就是包名）。

## 用法

1. 在任意会话行上点 `⋯`，选**删除会话**。
2. 确认框先向宿主问一次真实状态，写清楚：会删掉什么、它是不是还被 Harness 占用、还剩什么在工作。
3. 接着把整个家族画成一棵树让你挑：本对话一行，下面按「子智能体（n）」「派生对话（n）」两个可折叠分组展开，派生对话把自己那一层接在自己的块里面；每行都有勾选框（带标题、id 尾号和状态标记），分组标题的勾选框管这一块。不想删的把勾去掉。
4. 确认。按钮上写着即将删掉几个会话；如果还有在跑的工作，按钮会变成**停止并删除**，按下去先停掉那些工作。
5. 相关的行立刻从侧边栏消失，数据也从磁盘上没了。

批量的走法：点工作区标题行里、搜索图标**左边**那个垃圾桶图标，在按工作区分好区的列表里勾会话（勾母会话连带子会话，子会话可以单独勾），然后确认。

## HTTP 接口

客户端半通过 `ctx.webServer` 上四条同源 `exact` 路由访问宿主。纯 JS、无构建步骤的插件没法声明带类型的 `ctx.remote` 命名空间（那需要 Typert 生成产物），所以这里用的是社区插件 `dshmarket` 同款通道。

| 路由 | 方法 | 作用 |
|---|---|---|
| `/better-dsh-session-deletetool/inspect?sessionId=…` | GET | 返回 `stored` / `open` / `agent` / `running` / `activity` / `artifactDirectory` / `warnings`（没读到的血缘线索，避免"少几行"被当成"这个会话没有子会话"），以及 `descendants` = `{ count, subagents, derived, truncated, maxDeletable, items[] }`，其中每项带 `id`、`kind`、`depth`、`parentId`、`title`、`open`、`agent`、`running` 和它自己的 `activity` |
| `/better-dsh-session-deletetool/delete` | POST | body `{ sessionId, stop?, descendants? }`——`descendants` 不传表示整个家族，传空数组表示只删它自己；返回 `removed`、`descendants`（每条带 `kind`）、`kept`、`stoppedActivity`、`terminalsKilled`、`warnings`、`runtime`、`activity`。点到的名字不在家族里会在动手之前就以 `400 unknown-descendant` 拒绝 |
| `/better-dsh-session-deletetool/catalog` | GET | 返回 `{ ok, workspaces: [{ key, workspaceId, title, path, sessions[] }], totals }`；每个会话行带 `id`、`kind`（`root` / `subagent` / `derived`）、`depth`、`parentId`、`hasChildren`、`family`、`subagents`、`derived`、`title`、`cwd`、`open`、`agent`、`running`、`activity`。分区顺序就是注册表里工作区的顺序，`workspaceId` 为 `null` 的那个分区是"未归类" |
| `/better-dsh-session-deletetool/delete-batch` | POST | body `{ roots: [{ sessionId, descendants? }], stop? }`，每个根各自照单会话那条规则走一遍；返回 `{ ok, roots, removed[], failed[] }`。某个根失败只记一条 `failed`，不会中止其余。一次最多 200 个根 |

四条路由各自带同源校验：`Host` 必须是环回、`sec-fetch-site` 不能是 `cross-site`、`Origin` 存在时必须与 `Host` 同源。别的网站页面打不进来。

## 构成

| 文件 | 作用 |
|---|---|
| `host.js` | 宿主半：四条路由、工件/工程记录/缓存清理、子会话子树、按工作区分区的会话总览 |
| `client.js` | 客户端半：`sidebar.workspaces.session.menu.item` 菜单项（order 500）+ 批量图标 + 两个 `shell.overlay` 对话框 |
| `cordis.patch.yml` | 把宿主行插进 profile 层栈 |
| `test/host.test.mjs` | 路由测试，跑在真实临时目录上 |
| `icon.svg` | 插件图标（批量按钮画的是 `deleting icon.svg` 那个图） |

样式只用宿主主题 token（`--dsw-alias-*`），浅色深色都跟随；界面文案通过客户端 locale 服务本地化（英文 / 简体中文）。

批量入口为什么不注册一个新插槽：`sidebar.workspaces` 是 single 槽，第二个注册者会**顶掉**官方那套会话浏览器，而不是并排。所以客户端半注册在 `sidebar.footer.action`（本身不渲染任何东西），再把自己的按钮用 portal 挂进浏览器自己的搜索格子里，并用一个 `MutationObserver` 在 React 重渲染表头时补回来。这一步除了"打开弹窗"没有任何权限，真正干活的是宿主那两条路由。哪天 harness 改掉了这个格子的 CSS 类名，按钮会不出现，别的地方不受影响。

## 开发

```sh
node --test test/host.test.mjs
```

测试直接驱动真实的 `apply()` 注册，配假的宿主服务和真实的临时目录，覆盖：删除本体、有活时的拦截与停止、子会话子树、状态查询，以及各种拒绝路径（坏 id、坏 body、错方法、跨站来源）。

## 许可

[MIT](LICENSE)

## 作者

- Bilibili：<https://space.bilibili.com/220996778>
