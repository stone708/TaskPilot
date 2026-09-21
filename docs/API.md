# REST API

所有接口以 `http://127.0.0.1:8080/api/v1` 为前缀，并且只接受本机 `localhost` 或 `127.0.0.1` Host。请求和响应均为 JSON。

错误响应格式：

```json
{"error":"title is required"}
```

常见状态码为 `400`（输入不合法）、`404`（任务不存在）和 `409`（任务版本冲突）。

## 任务对象

```json
{
  "id": "c5cde7f8-6f25-4b39-ae4d-5a742b127a53",
  "shortId": "TASK-101",
  "title": "Prepare release notes",
  "description": "Use the changelog draft.",
  "status": "Doing",
  "priority": "High",
  "startAt": "2026-09-20",
  "dueAt": "2026-09-22",
  "tags": ["release"],
  "subtasks": [{"id":"…","title":"Collect changes","done":false,"position":0}],
  "related": ["another-task-uuid"],
  "createdAt": "2026-09-21T07:00:00Z",
  "updatedAt": "2026-09-21T07:00:00Z",
  "completedAt": null,
  "version": 2
}
```

- `id` 是 UUID；`shortId` 是递增的展示编号。
- `status` 可为 `Todo`、`Doing`、`Holding`、`Done`。
- `priority` 可为 `None`、`Low`、`Medium`、`High`、`Urgent`。
- 日期字段为 `YYYY-MM-DD`，不包含时分秒；时间戳为 UTC。
- `related` 中存储 UUID；创建或更新时也可传已有任务的 `TASK-数字`。

## 任务

### `GET /tasks`

返回任务数组。可选查询参数：

| 参数 | 含义 |
| --- | --- |
| `scope` | `today` 或 `inbox`。 |
| `status` | 指定任务状态。 |
| `tag` | 标签名称，大小写不敏感。 |
| `q` | 搜索标题、描述、标签和展示编号。 |
| `from` / `to` | 到期日期范围，格式为 `YYYY-MM-DD`。 |

```bash
curl 'http://127.0.0.1:8080/api/v1/tasks?scope=today'
```

### `POST /tasks`

创建任务。`title` 必填，其余字段可选。

```bash
curl -X POST http://127.0.0.1:8080/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Prepare release notes","priority":"High","dueAt":"2026-09-22","tags":["release"]}'
```

### `GET /tasks/{id}`

通过 UUID 或 `TASK-数字` 读取任务。

### `PATCH /tasks/{id}`

局部更新任务。未传字段保持不变；日期字段传 JSON `null` 会清除日期。更新应传当前 `version`，版本过旧时返回 `409`。

```bash
curl -X PATCH http://127.0.0.1:8080/api/v1/tasks/TASK-101 \
  -H 'Content-Type: application/json' \
  -d '{"version":2,"status":"Done","dueAt":null}'
```

### `DELETE /tasks/{id}`

删除任务，并自动清理双向关联。

## 标签

### `GET /tags`

返回按名称排序的标签字符串数组。

### `POST /tags`

创建标签。首尾空格和前导 `#` 会被移除；名称按大小写不敏感方式去重，并保留首次创建时的展示拼写。

```bash
curl -X POST http://127.0.0.1:8080/api/v1/tags \
  -H 'Content-Type: application/json' \
  -d '{"name":"#release"}'
```

## 统计与设置

| 方法和路径 | 返回内容 |
| --- | --- |
| `GET /health` | `{ "ok": true }`。 |
| `GET /stats` | `today`、`inbox`、`all` 和各状态的数量。 |
| `GET /settings` | 应用时区和本地数据位置说明。 |
| `POST /settings` | 提交 `{ "timezone":"Asia/Shanghai" }` 更新 Today 判断时区。 |
