# GPU Watcher

![Dashboard Preview](docs/asserts/index.png)

Next.js 控制面板，用一台主机通过 SSH 轮询多台 GPU 机器的 `nvidia-smi`，记录显卡实时状态、进程上下线、主机离线情况，并把 GPU 空闲或主机离线事件发送到 Telegram。

> 有多台服务器并行跑实验，之前必须逐台 SSH 查看 `nvidia-smi` 才能知道有哪些空闲 GPU，非常低效。GPU Watcher 通过单一面板聚合所有主机状态，确认空闲资源和排查任务只需看一个页面。


## 功能
- 每分钟并行执行 `nvidia-smi`，采集显存、利用率、温度、进程列表，写入本地 SQLite (`data/gpu_watcher.db`)。
- 计算事件：进程上线 / 下线、GPU 连续 5 分钟显存占用 < 10% 视为空闲、主机离线 / 恢复。
- GPU 空闲、主机离线即时推送 Telegram（可选）。
- 仪表盘展示三台机器当前状态，并提供 6 小时利用率/显存/温度曲线及事件时间线。

## 依赖
- Node.js 18+
- 每台 GPU 主机可通过当前主机 SSH 访问，并安装 `nvidia-smi`
- （可选）Telegram Bot 与 chat id

## 配置
所有配置放在仓库根目录的 `config/` 中，并且会被自动创建/更新：

1. **`config/hosts.json`** – 主机列表，UI 也会写入此文件。支持多行 JSON，示例参见 `docs/hosts.sample.json`。字段含义：
   - `id`: 唯一 ID，UI 展示及 API 使用。
   - `label`: 可选别名。
   - `connection`: `type: "ssh"`/`"local"`；SSH 需提供 `host`、`username`、可选 `privateKeyPath`（默认 `~/.ssh/id_ed25519`）。
2. **`config/settings.json`** – 运行参数（轮询频率、空闲窗口、曲线窗口、置顶/隐藏主机、Telegram Token/Chat ID 等）。通过网页 “设置” 标签修改后会立即落盘；若手动编辑 JSON，前端也会热加载。

首次启动会生成如下默认结构，可直接编辑：

```jsonc
// config/settings.json
{
  "pollIntervalMs": 60000,
  "idleWindow": 5,
  "idleThreshold": 0.1,
  "chartWindowHours": 24,
  "pinnedHosts": [],
  "hiddenHosts": [],
  "telegram": {
    "botToken": "",
    "chatId": "",
    "disableNotifications": false
  }
}
```

```jsonc
// config/hosts.json
[
  {
    "id": "lab",
    "label": "lab",
    "connection": {
      "type": "ssh",
      "host": "211.71.15.50",
      "username": "farong",
      "privateKeyPath": "~/.ssh/id_ed25519"
    }
  }
]
```

说明：
- 直接编辑 JSON 文件即可生效；服务会在下次轮询前自动重新加载。
- `config/hosts.json` / `config/settings.json` 默认被 `.gitignore` 忽略，避免把私钥路径、Telegram Token 等敏感信息提交到仓库。
- 如果机器无法连接，会写入事件 `host_offline` 并推送 Telegram；恢复时写入 `host_online`。

```json
[
  {
    "id": "lab",
    "connection": {
      "type": "ssh",
      "host": "211.71.15.50",
      "username": "farong",
      "privateKeyPath": "~/.ssh/id_ed25519"
    }
  },
  {
    "id": "4090",
    "connection": {
      "type": "ssh",
      "host": "10.134.48.81",
      "username": "farong",
      "privateKeyPath": "~/.ssh/id_ed25519"
    }
  }
]
```

> 如果需要放置在其它目录，可通过环境变量 `GPU_WATCHER_HOSTS_FILE` / `GPU_WATCHER_RUNTIME_FILE` 指定 JSON 路径，但日常使用建议直接编辑 `config/*.json`。

## 开发 / 运行
```bash
npm install
npm run dev      # http://<本机IP>:8005

# 生产
npm run build
npm start        # 以 NODE_ENV=production 启动 (默认端口 8005，监听 0.0.0.0)
```

保持 Node 进程常驻（PM2、systemd、Docker 均可）。数据库文件位于 `data/`，默认被 `.gitignore` 忽略。

## 结构
- `src/server/`：SQLite 存储、SSH 执行、nvidia-smi 解析、轮询与 Telegram 通知。
- `src/app/api/*`: 状态 / 事件 / 曲线接口，供前端 SWR 轮询。
- `src/components/dashboard/`: 客户端仪表盘，含曲线图（Recharts）与事件列表。

## 注意事项
- 轮询间隔 + nvidia-smi 执行时间 < 60 秒，否则下一轮会等待上一轮完成。
- 请确保运行进程用户可以读取 SSH 私钥，并且相应主机的 `~/.ssh/config` 已允许无口令登录。
- Telegram 推送失败会在日志里输出，并继续系统运行。
