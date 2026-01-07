# 项目概览

## 背景与动机
- 多台服务器（lab/4090/5090 等）分布在不同机房，只能通过 SSH 登录逐个执行 `nvidia-smi` 判断 GPU 空闲。
- 需要一个集中式面板：实时掌握 GPU 状态、快速发现空闲资源、保留进程上下线痕迹，并在设备离线时第一时间通知。
- 目标：零侵入式（远端无需额外 agent），在可信内网部署，分钟级轮询即可满足实验排队需求。

## 功能目标
1. **统一监控**：SSH 队列轮询所有主机，展示 GPU 利用率/显存/温度、当前进程（含容器与宿主信息）。
2. **事件追踪**：GPU 空闲/繁忙、进程上线/下线、主机离线/恢复写入 SQLite，并提供时间线 + Telegram 推送。
3. **趋势可视化**：最近 24 小时曲线（可切换利用率 / 显存 / 温度），并提供主机/GPU 维度的使用统计窗口（1d/1w/1m）。
4. **多主题 UI**：科技感浅色 + 深色主题，侧边栏可切换功能视图，支持主机置顶/隐藏与可配置的监控参数。

## 系统架构
```
┌────────────┐      SSH       ┌────────────┐
│ GPU Watcher│ ─────────────▶ │   lab/..   │
│   (Next.js │                └────────────┘
│ + Node Poll│
│    er)     │ ─────────────▶ 多台 GPU 主机
└────┬───────┘
     │HTTP API      SQLite  ┌────────────┐
     └────────────▶────────▶│data/*.db   │
                             └────────────┘
```

- **前端**：`src/components/dashboard/Dashboard.tsx`，使用 SWR 轮询 `/api/status`、`/api/events`、`/api/stats`，结合 Recharts 绘制曲线。
- **后端**：`src/server/poller.ts` 定时读取主机列表（`config/hosts.json`），通过 `ssh2` 执行两条命令：GPU 概况与进程列表，解析写入 `gpu_snapshots` 表。
- **存储**：`data/gpu_watcher.db`，内含 `gpu_snapshots`、`gpu_events`、`host_status` 等表，配有索引支持按 host/gpu/time 查询。
- **通知**：`src/server/telegram.ts` 用 `https` + `dns.lookup` (IPv4 强制) 推送事件。UI 提供 Bot Token / Chat ID 配置与测试按钮。

## 数据流
1. **配置**：`config/hosts.json` 标准化 host 描述；`config/settings.json` 保存轮询间隔、空闲判定、置顶/隐藏主机等。
2. **轮询**：`poller.run()` 每 `pollIntervalMs` 遍历 host -> `runCommand` (local or ssh) -> `parseGpuRows` / `parseProcessRows` -> `enrichProcessDetails` 捕获 `ps`, `docker inspect`。
3. **事件计算**：`store.upsertGpuSnapshot` 会比较历史状态，触发 `process_online/offline`, `gpu_idle/busy`, `host_offline/online`，每条事件写入 `gpu_events` 并可能 `sendTelegramMessage`。
4. **前端渲染**：Dashboard 根据 host/gpu 分组渲染卡片，进程列表点击弹窗查看用户/容器/父进程详情；图表按 24h 数据绘制，统计页聚合 usage/coverage/average 等指标。

## 采集策略
- 采样频率默认 1 分钟；利用 `idleWindow` + `idleThreshold`（显存占比）判定 GPU 是否空闲。
- 进程列表会过滤显存占用过小的任务（阈值为 max(配置占比 * 显存, `processDisplayMinMemoryMb`)），避免信息噪音。
- 解析 `cgroup` + `docker inspect` 推断容器 ID/Name、挂载路径和 USER 变量来还原“真实操作者”，并记录父进程链路帮助排查。

## UI 结构
1. **Welcome**：品牌动画 + 快速总体数据（在线主机/空闲 GPU/事件数/最近轮询） + GPU 快速概览列表 + 功能简介卡片。
2. **主机**：展示在线/离线状态、最后成功时间、错误原因、置顶/隐藏/编辑/删除等操作。
3. **GPU 监控**：分 host 卡片展示 GPU 列表、过滤后的进程表、24h 曲线选择器。
4. **使用统计**：选择 1d/1w/1m 与 host/gpu 维度查看 usage ratio、平均利用率/显存、数据覆盖率。
5. **事件时间线**：Host / Process 双列表 + 搜索、筛选。
6. **设置**：添加主机（含连接测试）、Telegram 参数、采集参数，并显示保存状态。

## 后续可扩展点
- 引入 WebSocket 推送减少轮询延迟。
- 增加多租户/权限模型，将“隐藏 host”拓展为按用户分组。
- 提供导出报表（CSV/Markdown）及事件 webhook。
