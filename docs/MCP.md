# TaskPilot MCP

启动本地服务后，MCP Streamable HTTP 地址为：

```text
http://127.0.0.1:8080/mcp
```

TaskPilot 只接受本机 `localhost` 或 `127.0.0.1` 请求。MCP 服务是无状态的 Streamable HTTP endpoint，使用官方 Go MCP SDK 实现；所有任务操作与 Web、REST、CLI 使用同一个本地 SQLite 数据库。

在支持 HTTP MCP 服务器的客户端中新增以下服务器配置，并按客户端界面或配置格式填入该 URL：

```json
{
  "name": "taskpilot",
  "transport": "streamable-http",
  "url": "http://127.0.0.1:8080/mcp"
}
```

可用工具：

| 工具 | 用途 |
| --- | --- |
| `task.create` | 创建任务；可传标题、描述、状态、优先级、日期、标签、子任务和关联任务。 |
| `task.get` | 通过 UUID 或 `TASK-数字` 读取一个任务。 |
| `task.list` | 按范围、状态、标签、关键词或到期日期列出任务。 |
| `task.today` | 按 TaskPilot 当前时区读取 Today 任务。 |
| `task.search` | 搜索全部任务的标题、描述、标签和编号。 |
| `task.update` | 局部更新任务；必须传当前 `version`，`startAt`、`dueAt` 传 `null` 可清除日期。 |
| `task.complete` | 将任务标记为 Done。 |
| `task.delete` | 删除任务并清理关联关系。 |
| `tag.list` | 列出标签。 |
| `tag.create` | 新建标签；允许以 `#` 开头。 |

`task.update` 的 `version` 来自 `task.get`、`task.create` 或其他任务工具返回值。版本过旧会作为 MCP 工具错误返回，因此自动化可重新读取任务后决定是否重试。所有工具结果包含 JSON 文本和结构化内容，适合聊天客户端和程序客户端读取。

示例参数：

```json
{
  "id": "TASK-101",
  "version": 3,
  "status": "Doing",
  "dueAt": null,
  "tags": ["work", "release"]
}
```
