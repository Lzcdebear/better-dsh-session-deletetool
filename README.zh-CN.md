# better-dsh-session-deletetool

**在 DeepSeek Harness 里真正删除一个会话，并管理它带出的整个家族。**

DSH 自带的只有归档。这个插件补上删除：会话日志目录、工作区记录、归档与置顶成员、投影缓存记录一起清掉，同时把判断要删什么的用量与目录摆在眼前。

[English](README.md)

---

## 功能

- **真删除。** 删除会话自己的日志目录，从工作区记录里移除，清掉归档与置顶成员，再删投影缓存记录。DSH 原生只有归档。
- **会话家族树。** 主会话、它的 Fork 子会话与子智能体，按 `parentSession` 逐层嵌套；子智能体再派生的子智能体自然更深一层。每个节点都有复选框，勾选父节点会带上它的后代。
- **每个会话的用量。** 一个节点只统计它自己发起的请求。主会话额外显示“自身/家族”，斜杠后是整个家族的合计。
- **三色 Token 条。** 缓存命中输入（绿）、缓存未命中输入（蓝）、输出（黄），下面列三条百分比。缓存命中率 = 命中 ÷（命中 + 未命中 + 写缓存）。
- **Fork 去重。** Fork 子会话继承的日志前缀会被跳过，请求再按消息 id 去重，不会把父会话过去的消耗重复计到子会话头上。
- **本地目录。** 每行右侧的文件夹按钮打开该节点自己的目录。路径由 Host 通过 `sessionPersistence.locate` 解析，不按会话名拼路径。
- **批量管理。** 每个家族一张卡片，支持按名称搜索、按最后活跃 / Token / 命中率排序、按类型与工作区筛选、分页、本页全选、删除选中，以及二次确认后的删除全部。
- **缓存控制。** 可以打开 DSH 的投影缓存目录，也可以刷新插件自己的用量缓存。

## 安装

四种方式都走 DSH 的插件管理器：

```bash
npm install better-dsh-session-deletetool
```

- GitHub：`plugin_manager { action: "install_bundle", target: "github:Lzcdebear/better-dsh-session-deletetool" }`
- 本地副本：`plugin_manager { action: "install_bundle", target: "<解压后的绝对路径>" }`
- 发布包：`https://github.com/Lzcdebear/better-dsh-session-deletetool/archive/refs/heads/main.tar.gz`

安装后刷新页面。改动 Host 侧需要完全重启 DSH。

卸载：`plugin_manager { action: "remove_bundle", target: "better-dsh-session-deletetool" }`。

## 用法

**单个会话。** 在会话的 `⋯` 菜单里选「删除会话」。对话框会画出家族树，显示这个会话自身的用量与家族合计、缓存分布，每一行都有文件夹按钮。

**批量。** 点工作区标题栏里的垃圾桶图标（在搜索图标左侧）。每个家族是一张卡片，可以勾选、筛选、排序、翻页，然后删除选中或删除全部。

删除前会先问 DSH 自己的活动准入：有正在运行的工作会先提示，确认后才停掉。

## HTTP 接口

挂在 `ctx.webServer` 上的同源路由：

| 路由 | 方法 | 用途 |
|---|---|---|
| `/better-dsh-session-deletetool/inspect?sessionId=…` | GET | 状态、家族行、每行用量与目录 |
| `/better-dsh-session-deletetool/delete` | POST | `{ sessionId, stop?, descendants? }` |
| `/better-dsh-session-deletetool/catalog` | GET | 全部会话及用量与目录，附全局汇总 |
| `/better-dsh-session-deletetool/delete-batch` | POST | `{ roots: [{ sessionId, descendants? }], stop?, cleanCache? }` |
| `/better-dsh-session-deletetool/open-directory` | POST | `{ sessionId }`，打开该会话目录 |
| `/better-dsh-session-deletetool/open-cache` | POST | 打开 DSH 的投影缓存目录 |
| `/better-dsh-session-deletetool/refresh-stats` | POST | 清空插件的用量缓存 |

所有路由都带回环与同源校验，别的页面访问不到。

## 构成

| 文件 | 作用 |
|---|---|
| `host.js` | Host 侧：路由、删除、家族遍历、清单与全局汇总 |
| `session-model.js` | 用量折叠、目录解析、缓存失效 |
| `client.js` | Client 侧：菜单项、批量入口、两个对话框 |
| `cordis.patch.yml` | 把 Host 行插进 profile 的层级栈 |
| `test/host.test.mjs` | 基于真实临时目录的路由测试 |
| `icon.svg` | 插件图标 |

样式只用宿主主题 token（`--dsw-alias-*`），明暗主题都能读；界面通过 Client locale 服务支持中英文。

## 已知边界

- Fork 的血缘读自 `inheritedEventCount`。当前构建里没有 Fork 样本，这条路径按字段语义实现，尚未在真实数据上验证。
- 持久化后端定位不到目录的会话，文件夹按钮保持禁用，提示里写明原因。
- 用量在首次读取时从日志折叠，之后复用“大小 + 修改时间”缓存。本机约九十个会话全量折叠不到一秒。

## 开发

```sh
node --test test/host.test.mjs
```

## 许可

[MIT](LICENSE)

## 作者

- Bilibili: <https://space.bilibili.com/220996778>
