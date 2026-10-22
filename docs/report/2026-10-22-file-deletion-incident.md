# 文件反复被删除事件：取证与结论

日期：2026-10-22
范围：`C:\Users\26298\OneDrive\Desktop\全栈开发\frontend\2026数字媒体`

## 一、结论

**不是病毒、不是火绒/Defender 隔离、不是 Windows 清理工具、也不是本仓库脚本或 AI 会话删除的。**

删除动作来自 **OneDrive 同步引擎**：

- OneDrive 于 **2026-10-21 22:33:31 自动更新并重启**（`C:\Program Files\Microsoft OneDrive\OneDrive.exe` v26.183.0920.0005；`setup\logs\Update_2026-10-21_143333…`；process StartTime 22:33:31）。
- **48 秒后（22:34:19）** OneDrive 同步引擎开始成批删除本地条目，随后又有两批。OneDrive 自带 `SafeDelete.db` 的 `deletes_last_touched_by_sync_engine` 表记录了 **169 条由同步引擎执行的删除**：
  - 10-21 22:34 批次 78 条（更新刚完成）
  - 10-22 00:xx 批次 62 条
  - 10-22 03:24 批次 29 条（最后一次，之后机器 04:51 睡眠，07:43 唤醒才发现文件没了）
- 项目恰好放在 **OneDrive 同步目录内**，且 `.git`（上万个小文件、频繁变动）+ 构建/截图/PDF 大量增删，把 OneDrive 拖进长期异常：`global.ini` 记录 **`PreviousDiagnosticsRunSyncProblemsCount = 26637`**；`SyncEngineDatabase.db` 的 `od_ServiceOperationHistory` 显示 `ChangeTokenExpired`、`DifferentialResync`、`CloudTriggered`、`ReadOnlyDatabase_ConnectMountedFolderScenario` 等重同步/只读数据库场景。
- 重同步/冲突处理阶段，OneDrive 按它认为正确的云端/本地状态执行删除，**不经回收站**（所以回收站里没有项目文件），`.git/objects` 这类目录被整目录清掉后就表现为「git 仓库损坏 + 源码批量消失」。

## 二、证据链

| 时间（本地） | 证据 | 说明 |
|---|---|---|
| 10-21 22:33:31 | OneDrive.exe 进程启动；`setup/logs/Update_2026-10-21_143333_16116-12828.log`、`Install_2026-10-21_143334…`、`Update\` 目录 mtime 22:33:38 | OneDrive 自动更新并重启 |
| 10-21 22:34:19 | `SafeDelete.db → deletes_last_touched_by_sync_engine` 第一批 78 条 | 更新完成 48 秒后开始删除 |
| 10-21 22:34—22:38 | 系统日志出现 Search 筛选器宿主进程被强制中止、.NET 分析 API 错误 | 索引/数据库异常同期出现 |
| 10-22 00:xx | 第二批 62 条 | 对应第一次发现「根目录配置 + .git 索引消失」 |
| 10-22 03:24:03—04 | 第三批 29 条（最后一批） | 对应 07:52 发现的「836 个已跟踪文件 + .git 对象库消失」 |
| 10-21 20:49:31 | `StoragePolicy\StoragePoliciesLastTrigger` | 存储感知已开启，且配置了云文件清理策略（`128=30`、`256=30` 天，"云备份文件夹中未使用内容"），会与 OneDrive 重同步叠加 |
| — | `filter_delete_info` 有 4966 条删除通知，进程为 Weixin/QQ/WPS/explorer 等，**没有一条项目路径** | 项目文件不是普通应用删除的（否则这里会有记录） |
| — | 火绒 `QuarantineEx.db` 仅 5 条（全是 `D:\steam\xinput1_4.dll`）；Defender 无威胁检测 | 排除杀软隔离 |
| — | 回收站无项目文件 | OneDrive 同步引擎删除不进回收站 |
| — | 仓库脚本/AI 会话无删除项目文件命令（`tools/**` 只删临时截图、`shutil` 只处理 `docs/deliverables/ppt-assets`）；`07:55 cleanmgr/DismHost` 在唤醒后且不处理用户工程文件 | 排除我们自己的工具与系统清理 |

## 三、为什么 `.git` 成了重灾区

1. `.git/objects` 是上万个小文件、内容频繁变化——OneDrive 最不擅长同步这种结构；一次整目录删除就足以让 index/refs 与对象对不上，表现为「fatal: not a git repository」「unable to read sha1 file」。
2. 更新后的重同步把「本地有、云端没来得及收」的文件判定成多余项删除；我们恰好在高频构建/提交。
3. 项目在 `OneDrive\Desktop\...` 下（OneDrive 根目录内），没有排除规则。

## 四、附带发现（一个我们自己的坑）

`.gitignore` 里曾有一条 `deliverables/`，它匹配了 **`docs/deliverables/`**，导致新生成的 7 张截图、AI 说明文档等进入不了 git；这些文件在删除后无法从 git 恢复（只能重新生成）。该规则已改为只忽略根目录 `/deliverables/`。

## 五、处置与建议

已做：

- 停止 OneDrive 进程（当前未运行），避免继续影响；
- 用 GitHub 远端克隆恢复仓库（`63f84cf`），并从 `D:\backups\live` 取回未提交产物；
- 修复 `.gitignore`；补齐截图、AI 使用说明；重新构建、重打正式 ZIP；
- 已推送 `66d0e18`；保留 `D:\backups\live`（每 2 分钟增量）与 `D:\backups\reclone-0752`（完整克隆）。

建议（提交前）：

1. **把工程移出 OneDrive 同步目录**（如 `D:\work\2026数字媒体`），OneDrive 只放最终 ZIP/PDF；若暂时不迁，至少在 OneDrive 设置里「停止同步此文件夹」。
2. 关闭存储感知的云内容清理：设置 → 系统 → 存储 → 存储感知 → 关闭「删除云备份文件夹中未使用的内容」；注册表 `StoragePolicy` 下 `128`、`256` 置 0。
3. **提交完成前不要重启 OneDrive**；重启后先观察首轮同步（可先让项目处于移出状态）。
4. `.git` 永远不要放同步目录；工作用本地盘 + GitHub 远端 + 本地备份三份。
5. 如需找回更早被删的文件，可登录 OneDrive 网页版 → 回收站（保留 30 天）尝试恢复。

## 六、复现证据文件

- `D:\backups\od-copy\SafeDelete.db`（OneDrive 删除记录）
- `D:\backups\od-copy\SyncEngineDatabase.db`（同步引擎状态）
- `D:\backups\od-delete-report.txt`、`od-delete-wave.txt`（本次取证导出）
- `%LOCALAPPDATA%\Microsoft\OneDrive\setup\logs\Update_2026-10-21_143333_16116-12828.log`
- `%LOCALAPPDATA%\Microsoft\OneDrive\settings\Personal\global.ini`
