# TaskPilot

TaskPilot 是一个本地优先、单用户的个人任务管理器。它将 React Web 界面、Go REST API、CLI 和 MCP 服务打包在同一个本地进程中，任务数据只保存在本机 SQLite 数据库。

界面使用英文；本文档与开发说明使用中文。

## 功能

- 创建、编辑、删除任务，支持 Todo、Doing、Holding、Done 状态与五级优先级。
- 支持开始日期、到期日期、标签、描述、子任务与双向关联任务。
- Today、Inbox、状态、标签和全局搜索视图；Today 使用应用设置的时区计算。
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

升级前先停止 TaskPilot，然后复制数据库文件作为备份。恢复时在服务停止状态下，将备份文件复制回原数据位置或使用 `--data` 指向该文件。新版本启动时会自动执行数据库迁移；不要在运行时直接复制 SQLite 文件。

## 项目范围

TaskPilot 当前面向个人桌面使用。本版本不提供账户、多用户同步、远程访问、移动端、通知、内置聊天、自然语言任务解析或项目管理。欢迎通过 Issue 讨论需求，但请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
