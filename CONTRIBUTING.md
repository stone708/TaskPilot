# 贡献指南

感谢你考虑为 TaskPilot 贡献代码。这个仓库保持本地优先、单用户和跨平台可运行的方向；提交前请确认改动符合该目标。

## 开始前

1. 在 Issue 中描述 bug 或功能想法，较大的改动先讨论设计和范围。
2. 从 `main` 创建分支，分支名请清楚表达目的，例如 `fix/task-save-conflict`。
3. 不提交真实任务数据库、`node_modules/`、本机配置或构建二进制。

## 本地环境

- Go 1.26+
- Node.js 22+ 与 npm
- SQLite 通过纯 Go 的 `modernc.org/sqlite` 驱动提供，不需要 CGO。

```bash
npm install
npm run build
go run ./cmd/taskpilot --data /tmp/taskpilot-contributor.db serve
```

请使用独立的 `--data` 文件测试，避免修改自己的日常任务库。

## 改动约定

- Web 界面文案使用英文；README、开发和操作说明使用中文。
- REST、CLI、Web 与 MCP 应共享 `internal/app` 中的任务规则，不能为某个入口复制一套数据库逻辑。
- 任务写入必须使用事务；关联保持双向，标签保持大小写不敏感去重。
- 不要将 API token、个人数据或绝对本机路径写入源码或文档。
- 保持 `gofmt` 和 TypeScript 严格检查通过。优先使用清晰的小函数和明确类型。

## 测试清单

提交前执行：

```bash
npm test
npx tsc --noEmit
npm run build
go test ./...
```

涉及任务写入时，至少覆盖创建、更新版本冲突、日期清除、标签、关联或子任务中的相关场景。涉及 MCP 时，使用 MCP SDK 客户端测试工具调用；涉及 Web 时，在浏览器中检查保存、取消和错误状态。

## Pull Request

PR 描述应说明：

1. 用户可观察到的问题和修改后的行为。
2. 关键实现或兼容性取舍。
3. 执行过的测试命令及结果。
4. 若界面变化明显，附一张截图或简短录屏。

请避免在同一个 PR 混入重构、功能扩展和无关格式化。维护者可能会要求拆分，以便更容易审核和回退。
