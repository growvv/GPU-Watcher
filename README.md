# GPU Watcher

![Dashboard Preview](docs/asserts/index.png)

> 有多台服务器并行跑实验，之前必须逐台 SSH 查看 `nvidia-smi` 才能知道有哪些空闲 GPU，非常低效。

GPU Watcher 通过单一面板聚合所有主机状态，确认空闲资源和排查任务只需看一个页面。


## 功能
- 定期采集各主机上显卡状态，包括显存占用、利用率、温度、进程列表。
- 历史曲线：可查看过去的显卡使用情况
- 事件通知： GPU 空闲 / 繁忙、主机离线 / 恢复。 可通过 Telegram Bot 推送到手机。

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


## 开发 / 运行
```bash
npm install
npm run dev      # http://<本机IP>:8005

# 生产
npm run build
npm start        # 以 NODE_ENV=production 启动 (默认端口 8005，监听 0.0.0.0)
```

## 结构
- `src/server/`：SQLite 存储、SSH 执行、nvidia-smi 解析、轮询与 Telegram 通知。
- `src/app/api/*`: 状态 / 事件 / 曲线接口，供前端 SWR 轮询。
- `src/components/dashboard/`: 客户端仪表盘，含曲线图（Recharts）与事件列表。

## 注意事项
- 请确保运行此项目的主机可以 SSH 访问各 GPU 主机。
