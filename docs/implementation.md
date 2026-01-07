# 实现细节

## 目录速查
| 路径 | 说明 |
| --- | --- |
| `config/hosts.json` | 主机配置文件（由 UI 写入，可手动编辑，多行 JSON） |
| `config/settings.json` | 运行时配置：轮询/空闲阈值/统计窗口/Telegram 等，UI 会落盘 |
| `src/server/` | Node 端核心：轮询、命令执行、解析 `nvidia-smi`、数据库、通知 |
| `src/app/api/*` | 前端使用的 Next.js Route Handler，暴露状态/事件/统计等 JSON |
| `src/components/dashboard/` | 客户端 Dashboard 组件，包含所有页签逻辑、主题切换、弹窗等 |

## 服务端
### 配置加载 (`src/config/*`)
- `hosts.ts`：统一读取/写入 `config/hosts.json`（或 `GPU_WATCHER_HOSTS_FILE` 指定路径），支持热加载，多客户端编辑也能生效。
- `runtime.ts`：读取/写入 `config/settings.json`，暴露 `getRuntimeConfig`/`updateRuntimeConfig`，包括 `pollIntervalMs`、`idleThreshold`、`pinnedHosts`、`hiddenHosts`、Telegram 设置等，并在文件变动时自动重新加载。

### 命令执行 (`src/server/commandRunner.ts`)
- `ssh2` `Client` + `wrapRemoteCommand("bash -lc ...")`，默认私钥 `~/.ssh/id_ed25519`，也支持 agent (`SSH_AUTH_SOCK`)。
- `HostConfig.type === 'local'` 时直接 `exec`.

### 采集流程 (`src/server/nvidia.ts` + `poller.ts`)
1. `poller.pollHost(host, config)` -> `collectSnapshotsForHost(host)`。
2. 同时执行两条命令：
   - `GPU_QUERY`: `nvidia-smi --query-gpu=...` 拉 GPU 指标。
   - `PROCESS_QUERY`: `nvidia-smi --query-compute-apps=...` 获取运行进程 PID/显存。
3. `parse...` 将 CSV 解析成对象。
4. `enrichProcessDetails`：
   - `ps -o pid,ppid,user,etimes,command` 填充命令、用户、启动时间。
   - `cgroup` + 正则提取 Docker 容器 ID，`docker inspect` 查挂载路径或 `USER` 环境变量，推断 `ownerHint`。
   - 如需父进程信息，会递归补充 `primaryDetails`.
5. `store.upsertGpuSnapshot` 写入 `gpu_snapshots` 表，并根据历史状态写 `gpu_events`；GPU 空闲/主机离线事件会调用 `telegram.ts` 推送。

### 数据库 (`src/server/db.ts` + `store.ts`)
- 使用 `better-sqlite3`，启动时自动建表：
  - `gpu_snapshots(host_id,gpu_index,...)`
  - `gpu_events(id, host_id, gpu_index, type, details, created_at)`
  - `host_status(host_id, is_online, last_seen, offline_since, last_error, label)`
- `store.ts` 提供：
  - `listGpuStatuses()` / `listHostStatuses()`：供 `/api/status`。
  - `listEvents(limit, offset)`：供 `/api/events`。
  - `listSnapshots(hostId, gpuIndex, since)`：供 `/api/snapshots`.
  - `getUsageStats(...)`：供 `/api/stats` 计算 1d/1w/1m usage/coverage。

### API
- `/api/status`：返回 hosts、gpus、运行时配置。前端 SWR `refreshInterval` = poll interval。
- `/api/events`：最新 50 条事件。
- `/api/snapshots`：单个 GPU 最近 24 小时曲线（可配置 windowHours）。
- `/api/stats`：主机/GPU 使用统计窗口。
- `/api/hosts`：POST 新增 / DELETE 删除主机。
- `/api/settings`：更新 runtime 设置（包含 pinned/hidden host、采集参数、Telegram）。
- `/api/tools/test-ssh` / `/api/tools/test-telegram`：UI “测试”按钮调用的即时接口。

## 前端 Dashboard
### 状态管理
- React Client Component，基于 SWR 拉取 `status/events/stats`，使用 `useMemo` 根据 `pinnedHosts`、`hiddenHosts`、host definitions 过滤/排序。
- `manualSelection` + fallback 选择 GPU 以驱动曲线和进程详情。
- `runtimeSettings` 保存服务器下发的 pinned/hidden/Telegram 配置，更新后写回 settings.json。

### 视图结构
1. **Sidebar**：GW 标志 + 主题切换按钮 + 功能导航（欢迎、主机、GPU 监控、使用统计、事件时间线、设置）。
2. **Home**：宏观指标 + GPU 快速概览（最多四块 GPU） + 功能卡片。
3. **GPU 监控**：24 小时曲线 + host 分组卡片 + 进程表 + 进程详情 modal。
4. **主机**：在线/离线/待采样标记、置顶/隐藏按钮、编辑/删除操作。
5. **使用统计**：按 host/gpu + 1d/1w/1m 维度显示 usage ratio、平均利用率/显存。
6. **事件时间线**：Host 与 Process 两列，可按类型过滤与文本搜索。
7. **设置**：新增主机（含连接测试）、Telegram 参数（保存/发送测试）、采集参数编辑。

### 主题与样式
- 使用自定义 `themed(light, dark)` helper + Tailwind 类，结合渐变背景、高对比边框，保证浅色主题也能清晰区分状态。
- `document.documentElement.dataset.theme` + localStorage 记忆用户选择。

## 运行方式
1. 首次启动后生成 `config/hosts.json` 与 `config/settings.json`，按需编辑（或直接在网页 “设置/主机” 页面修改）。
2. `npm run build && npm start`，默认监听 `0.0.0.0:8005`，可通过 Nginx 反代。
3. 在 UI 中录入 Telegram Token / Chat ID（会写入 `config/settings.json`），并点击“发送测试”验证。
4. 主机状态页可置顶常用 host、隐藏不再关注的 host（隐藏后在 GPU/统计中不再显示，但仍在设置页可恢复）。

## 故障排查
- SSH 失败：在主机卡片显示 `lastError`，并在事件时间线看到 `host_offline` 信息；确认 `~/.ssh/config`、防火墙和私钥权限。
- Telegram 超时：`[gpu-watcher] Failed to send telegram message TypeError: fetch failed`，通常是内网 DNS 没有 IPv4，已强制 `dns.lookup` 走 IPv4，如仍失败需检查防火墙或代理。
- DB 锁或损坏：默认位于 `data/gpu_watcher.db`，可在停止服务后备份；通过 `GPU_WATCHER_DB_PATH` 改到 NVMe SSD 以提升性能。
