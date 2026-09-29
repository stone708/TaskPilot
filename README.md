# TaskPilot

TaskPilot 是一个本地优先、单用户的个人任务管理器。它将 React Web 界面、Go REST API、CLI 和 MCP 服务打包在同一个本地进程中，任务数据只保存在本机 SQLite 数据库。

界面使用英文；本文档与开发说明使用中文。

## 功能

- 创建、编辑、删除任务，支持 Todo、Doing、Holding、Done 状态与五级优先级。
- 支持开始日期、到期日期、标签、描述、子任务、带时间戳的可编辑评论与双向关联任务。
- Today、Inbox、状态、标签和全局搜索视图；支持 List 与四列 Kanban 视图。Today 显示开始日已到但尚未完成的任务；未设置开始日时，到期日会作为兜底。
- 描述支持安全的 GitHub Flavored Markdown 预览，包括标题、列表、表格、链接与代码块。
- 乐观版本号：Web、REST 和 MCP 同时编辑同一任务时，旧版本更新会返回冲突。
- 本地 REST API、命令行和基于官方 Go SDK 的 MCP Streamable HTTP endpoint。
- Go 可执行文件内嵌 Web 产物；macOS 和 Windows 交叉构建脚本随仓库提供。

## 快速开始

需要 Go 1.26+、Node.js 22+ 与 npm。首次启动会自动创建数据库和表结构。

```bash
git clone https://github.com/stone708/TaskPilot.git
cd TaskPilot
npm install
npm run build
go run ./cmd/taskpilot serve
```

打开 <http://127.0.0.1:8080>。服务只监听本机地址，不能作为远程多用户服务使用。

数据库默认位于系统用户配置目录：

| 系统 | 默认位置 |
| --- | --- |
| macOS | `~/Library/Application Support/TaskPilot/taskpilot.db` |
| Windows | `%AppData%/TaskPilot/taskpilot.db` |
| Linux | `$XDG_CONFIG_HOME/TaskPilot/taskpilot.db`，或 `~/.config/TaskPilot/taskpilot.db` |

开发、测试或隔离数据时可指定数据库文件：

```bash
go run ./cmd/taskpilot --data /tmp/taskpilot-dev.db serve
```

## 使用方式

### Web

- `C`：新建任务（输入框中不会触发）。
- `Ctrl/Cmd + K`：聚焦全局搜索。
- `Esc`：关闭任务编辑框；有未保存修改时会请求确认。
- 使用页面标题右侧的 **List / Kanban** 切换任务呈现方式。Kanban 保留当前筛选范围，拖动卡片到另一状态列即可更新任务状态。
- 点击任务会打开全屏工作区。Description 区域使用更大的 **Edit / Preview** 编辑并预览 Markdown；任务描述保存为原始 Markdown 文本，可继续通过 REST、MCP 和 CLI 使用。
- 评论会直接保存并显示创建时间；编辑评论会更新其显示时间。可从协调的紫、蓝、薄荷、琥珀和玫瑰色中选择评论背景，不需要再次保存整个任务。
- 在 Description 的 **Add image** 中可插入 PNG、JPEG、GIF、WebP 或 AVIF 图片（单张最多 5 MB）。图片会作为 Base64 数据 URI 保存在 Markdown 描述中；编辑时显示短引用，避免 Base64 占满输入框。Preview 中可用滑块调整图片宽度，高度会保持原始比例。

### CLI

CLI 通过已运行的本地服务调用 REST API：

```bash
# 新增、读取与筛选
go run ./cmd/taskpilot task add "Write release notes"
go run ./cmd/taskpilot task list
go run ./cmd/taskpilot task today
go run ./cmd/taskpilot task show TASK-101

# 快捷更新状态
go run ./cmd/taskpilot task doing TASK-101
go run ./cmd/taskpilot task done TASK-101
```

服务不在默认地址时，使用 `--server`：

```bash
go run ./cmd/taskpilot --server http://127.0.0.1:18080 task list
```

### REST 与 MCP

- REST API 参考：[docs/API.md](docs/API.md)
- MCP 连接、工具和示例：[docs/MCP.md](docs/MCP.md)

## 开发

```bash
# 前端开发服务器（Go 服务仍负责 API）
npm run dev

# 检查
npm test
npx tsc --noEmit
go test ./...

# 构建内嵌的生产 Web 产物
npm run build
```

前端源代码位于 `web/src/`，构建结果会写入 `internal/app/static/` 并被 Go 的 `embed.FS` 打入可执行文件。服务、SQLite 迁移和 MCP 实现在 `internal/app/`；命令行入口在 `cmd/taskpilot/`。

贡献流程、代码规范和测试约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
系统组件和数据一致性设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。安全问题请遵循 [SECURITY.md](SECURITY.md) 的报告方式。

## 发布、升级与备份

```bash
./scripts/release.sh
```

脚本会构建 macOS arm64、macOS amd64 和 Windows amd64 二进制，执行 Go 测试，并在 `dist/` 输出 SHA-256 校验文件。Windows 的手工验收步骤见 [docs/WINDOWS-VALIDATION.md](docs/WINDOWS-VALIDATION.md)。

TaskPilot 会在启动时检查 `schema_migrations`。检测到待执行迁移时，会**先**在数据库目录的 `backups/` 下创建一个 SQLite 一致性快照，再以事务执行每个迁移；控制台会输出备份的完整路径。没有待执行迁移的普通启动不会额外创建备份。请保留该备份，直到确认升级后的任务、标签和关联关系都正常。

建议升级步骤：停止旧服务，替换可执行文件并启动新版本，记录控制台显示的备份路径，然后检查数据。若迁移失败，服务会停止且迁移事务回滚；可用迁移前的备份恢复。若旧版本程序尝试打开更高的数据库版本，TaskPilot 会拒绝启动，避免降级写入。

恢复时先停止 TaskPilot，将当前数据库移到安全位置，再将 `backups/` 中需要的 `.db` 文件复制为原数据库文件，或使用 `--data` 指向该备份进行检查。运行中的 SQLite 数据库不要直接复制；需要额外的人工备份时，先停止服务再复制数据库文件。

## 项目范围

TaskPilot 当前面向个人桌面使用。本版本不提供账户、多用户同步、远程访问、移动端、通知、内置聊天、自然语言任务解析或项目管理。欢迎通过 Issue 讨论需求，但请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
