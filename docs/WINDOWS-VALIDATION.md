# Windows 手工验收

1. 将 `taskpilot-windows-amd64.exe` 放入含中文字符的目录。
2. 在 PowerShell 执行 `./taskpilot-windows-amd64.exe serve`，并在浏览器打开 `http://127.0.0.1:8080`。
3. 创建任务、修改状态和标签，停止服务后再次启动，确认数据仍在。
4. 第二次启动服务时保留第一个进程，确认端口占用错误清晰可见。
5. 用新版本二进制替换旧版本，启动后确认任务、标签和关联关系仍在。
6. 当发布版本包含数据库迁移时，首次启动会在 `%AppData%\TaskPilot\backups\` 创建 `taskpilot-before-migration-...db`，且控制台会打印其路径。确认该文件存在，再检查升级后的数据。
7. 关闭服务后，以 `--data` 指向该备份启动一次，确认能读取迁移前的数据；然后用正常数据路径重新启动新版本。若需要恢复，先停止服务，再将备份复制为 `taskpilot.db`。
