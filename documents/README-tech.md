# LAN Sync - Obsidian 局域网同步插件（技术文档）

一款类似 LocalSend 的 Obsidian 插件，支持在局域网内不同设备间自动同步 Obsidian 仓库、绑定设备关系、分享笔记。

## 架构概览

```
Desktop A (全能力节点)                Desktop B (全能力节点)
+--------------------+               +--------------------+
| UDP Discovery      |  <--UDP广播--> | UDP Discovery      |
| HTTP Server (:24532)|  <--HTTP----> | HTTP Server (:24532)|
| WebSocket Server   |  <--WS----->  | WebSocket Server   |
| Sync Engine        |               | Sync Engine        |
| AES-256-GCM        |               | AES-256-GCM        |
+--------------------+               +--------------------+
         ^                                    ^
         | HTTP + WS (requestUrl)             | HTTP + WS (requestUrl)
         v                                    v
+--------------------+               +--------------------+
| Mobile C (客户端)   |               | Mobile D (客户端)   |
| HTTP/WS Client     |               | HTTP/WS Client     |
| AES-256-GCM        |               | AES-256-GCM        |
+--------------------+               +--------------------+
```

### 端口分配

| 端口 | 协议 | 用途 |
|------|------|------|
| 24531 | UDP | 设备发现广播 |
| 24532 | TCP | HTTP Server + WebSocket |

### 网络层抽象

通过 `INetworkTransport` 接口隔离桌面端与移动端的网络差异：

```typescript
interface INetworkTransport {
  startServer(port: number, requestHandler: (req: any, res: any) => void): Promise<void>;
  stopServer(): Promise<void>;
  sendRequest(url: string, options: RequestInit): Promise<any>;
  startDiscovery(onMessage: (msg: DiscoveryMessage, address: string) => void): Promise<void>;
  stopDiscovery(): Promise<void>;
  getLocalIP(): string;
  isServerCapable(): boolean;
}
```

- **桌面端** (`DesktopNetworkTransport`)：UDP `dgram` 广播 + Node.js `http.Server` + `fetch`
- **移动端** (`MobileNetworkTransport`)：仅 `requestUrl()` HTTP 客户端，`isServerCapable()` 返回 `false`

### 项目结构

```
src/
├── main.ts                          # 插件入口，初始化与集成
├── types.ts                         # 全局类型定义
├── settings.ts                      # 设置数据模型
├── i18n.ts                          # 国际化（支持 6 种语言 + 随机别名生成）
├── utils.ts                         # 共享工具函数（文件类型判断、Base64 编解码、目录创建等）
├── services/
│   ├── deviceIdentity.ts            # 设备身份（UUID + 中文别名）
│   ├── discoveryService.ts          # 设备发现（UDP/手动）
│   ├── httpClient.ts                # HTTP 客户端（分片+加密）
│   ├── cryptoService.ts             # AES-256-GCM 加密服务 + MD5 哈希
│   ├── websocketService.ts          # WebSocket Server（桌面端）
│   ├── websocketClient.ts           # WebSocket Client（跨平台）
│   ├── pairingService.ts            # 设备绑定（验证码+绑定关系）
│   ├── syncEngine.ts                # 同步引擎（定时+增量）
│   ├── historyManager.ts            # 历史副本管理
│   ├── shareService.ts              # 笔记分享服务
│   └── network/
│       ├── networkInterface.ts      # INetworkTransport 接口
│       ├── desktopNetwork.ts        # 桌面端网络实现
│       ├── mobileNetwork.ts         # 移动端网络实现
│       └── httpServer.ts            # HTTP API 路由分发
└── ui/
    ├── settingsTab.ts               # 设置面板
    ├── deviceListModal.ts           # 设备列表弹窗
    ├── addDeviceModal.ts            # 手动添加设备弹窗
    ├── verificationModal.ts         # 验证码弹窗
    ├── pairRequestNotice.ts         # 绑定请求通知
    ├── unbindConfirmModal.ts        # 解绑确认弹窗
    ├── syncHistoryModal.ts          # 同步历史详情弹窗
    ├── shareReceiveModal.ts         # 分享接收确认弹窗
    └── blacklistModal.ts            # 黑名单管理弹窗
```

## 核心模块详解

### 1. 设备发现 (`discoveryService.ts`)

**桌面端**：UDP 广播自动发现
- 每 3 秒向 `255.255.255.255:24531` 广播设备信息
- 30 秒无响应标记为离线
- 90 秒无响应从列表移除

**移动端**：手动连接
- 用户在设置页输入桌面设备 IP:Port
- 通过 `requestUrl()` 发送 HTTP 请求验证连通性

### 2. 设备绑定 (`pairingService.ts`)

绑定流程：
1. 发起方生成 6 位随机验证码（5 分钟过期）
2. 目标方输入验证码校验
3. 校验通过后自动建立绑定关系，当前仓库纳入同步范围
4. 生成 `BindingGroup` 持久化到设置
5. 从 `bindingId + deviceIds` 派生 AES-256 密钥（SHA-256）

每个绑定组包含 2 台设备，同一设备可参与多个绑定组，形成多对多同步关系。

### 3. 加密服务 (`cryptoService.ts`)

**算法**：AES-256-GCM

| 项目 | 说明 |
|------|------|
| 密钥长度 | 256 bit (32 bytes) |
| 密钥派生 | `SHA-256(bindingId:deviceId1:deviceId2:...)` |
| IV | 每次加密随机生成 12 bytes（GCM 推荐 96-bit） |
| Auth Tag | GCM 模式自动生成 16 bytes |
| 数据格式 | `base64(iv[12] + authTag[16] + ciphertext)` |

密钥管理：
- 绑定时自动派生
- 可导出为 hex 字符串持久化
- 可从 hex 恢复（插件重载时）

### 4. 分片传输 (`httpClient.ts`)

**触发条件**：文件内容 > 配置的分片大小（默认 10MB）

**上传流程**：
```
POST /api/sync/upload/init    → { sessionId, filePath, totalChunks, metadata }
POST /api/sync/upload/chunk   → { sessionId, chunkIndex, data (加密后) }  × N
POST /api/sync/upload/complete → { sessionId }
```

**下载流程**：
```
POST /api/sync/pull  → { files: [...] }
→ 服务端返回文件内容（大文件自动分片），客户端逐片解密拼接
```

每个分片独立加密，避免移动端大文件 OOM。

### 5. WebSocket 长连接 (`websocketService.ts` + `websocketClient.ts`)

**Server（桌面端）**：
- 挂载在 HTTP Server 的 `/ws` 路径
- 使用 `ws` 库实现 WebSocket 升级
- 管理已连接客户端 Map（deviceId → { ws, deviceId }）
- 支持广播消息到所有客户端

**Client（跨平台）**：
- 桌面端使用 `ws` 库，移动端使用原生 `WebSocket`
- 自动重连：指数退避策略，最大间隔 30 秒
- 心跳保活：每 15 秒发送 ping
- 连接时携带 `deviceId` 参数用于身份识别

**消息类型**：
- `ping` / `pong`：心跳保活
- `device-info` / `device-info-response`：设备身份识别
- `pair-request` / `pair-confirmed` / `pair-rejected` / `pair-cancelled`：绑定流程
- `unbind-notify`：解绑通知
- `sync-manifest-response` / `sync-pull-response` / `sync-push-ack` / `sync-delete-ack`：同步数据
- `share-request`：分享通知

### 6. 同步引擎 (`syncEngine.ts`)

**同步流程**：
1. 定时器触发（默认 15 分钟）或手动触发
2. 向所有绑定设备请求文件清单（`POST /api/sync/manifest`）
3. `computeDiff()` 对比各设备文件的 mtime + hash
4. 以拥有最晚 mtime 的设备为源
5. 差异文件通过分片 API 拉取（自动加密传输）
6. 写入前调用 `historyManager.createCopy()` 创建历史副本
7. 写入本地仓库
8. 检测本地删除的文件，通过 `POST /api/sync/delete` 通知其他设备同步删除

**增量策略**：文件级对比，非内容级
- 清单包含：`{ path, mtime, hash }`
- hash 用于快速判断内容是否变化
- mtime 用于确定哪个版本更新
- 同步历史记录包含文件变更类型（add/modify/del）

### 7. 历史副本管理 (`historyManager.ts`)

- 存储目录：`.obsidian/.lan-sync-history/`（可配置）
- 目录结构与仓库保持一致
- 命名格式：`原文件名_YYYYMMDD_HHmmss.md`
- 自动清理：每个文件保留最近 N 个副本（默认 5），超出自动删除最旧的
- 与 Obsidian File Recovery 核心插件互补

### 8. 设置数据模型 (`settings.ts`)

- `PluginSettings` 定义所有持久化配置，通过 `loadData()` / `saveData()` 读写 `data.json`
- `saveSettings()` 自动剥离 `syncHistory` 字段，避免大量同步记录写入主设置文件
- 同步历史独立存储在 `sync-history.json`，通过 `loadSyncHistory()` / `saveSyncHistory()` 单独读写
- 哈希缓存存储在 `.lan-sync-hash-cache.json`，用于增量检测文件变更和删除

### 9. 笔记分享 (`shareService.ts`)

- 右键菜单 → "分享到设备..."
- 目标端弹窗确认（无论设备是否已绑定）
  - 接收：保存到仓库根目录
  - 另存为：用户选择保存路径
  - 拒绝：不计入
  - 加入黑名单：拒绝 + 记录设备 ID
- 自动拉黑：连续拒绝同一设备 ≥ 阈值（默认 3 次）自动加入黑名单

## HTTP API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/device` | 获取本机设备信息 |
| GET | `/api/health` | 健康检查 |
| POST | `/api/pair/request` | 发起绑定（生成验证码） |
| POST | `/api/pair/verify` | 验证码校验 |
| POST | `/api/pair/confirm` | 确认绑定完成 |
| POST | `/api/pair/reject` | 拒绝绑定请求 |
| POST | `/api/pair/cancel` | 取消绑定请求 |
| POST | `/api/message` | 通用消息通道 |
| POST | `/api/sync/manifest` | 获取文件清单 |
| POST | `/api/sync/pull` | 拉取同步文件 |
| POST | `/api/sync/push` | 推送同步文件 |
| POST | `/api/sync/delete` | 同步删除文件 |
| POST | `/api/sync/history` | 同步历史记录 |
| POST | `/api/sync/upload/init` | 初始化分片上传 |
| POST | `/api/sync/upload/chunk` | 上传单个分片 |
| POST | `/api/sync/upload/complete` | 完成分片上传 |
| POST | `/api/share` | 接收分享笔记 |
| GET | `/ws` | WebSocket 连接 |

## 平台支持矩阵

| 功能 | 桌面端 (Win/Mac/Linux) | 移动端 (Android/iOS) |
|------|:---:|:---:|
| UDP 广播发现 | ✅ | ❌ (WebView 限制) |
| HTTP Server | ✅ | ❌ (WebView 限制) |
| WebSocket Server | ✅ | ❌ (WebView 限制) |
| HTTP Client (`requestUrl`) | ✅ | ✅ |
| WebSocket Client | ✅ | ✅ |
| AES-256-GCM 加密 | ✅ | ✅ |
| 分片传输 | ✅ | ✅ |

> 移动端运行在 Capacitor WebView 中，无法使用 Node.js 网络 API（`dgram`、`http.Server`、`ws`）。通过 `INetworkTransport` 抽象接口隔离差异，移动端仅实现客户端能力。

## 开发

### 环境要求

- Node.js >= 18
- npm
- Obsidian >= 1.0

### 安装依赖

```bash
npm install
```

> 如果 esbuild postinstall 被阻止，运行：`npm install-scripts approve esbuild && npm install`

### 开发模式（watch）

```bash
npm run dev
```

文件修改后自动重新编译，在 Obsidian 中重新加载插件即可生效。

### 生产构建

```bash
npm run build
```

编译产物为根目录下的 `main.js`（esbuild 打包，单文件）。

### 构建配置

- **打包工具**：esbuild
- **目标格式**：ESM（Obsidian 插件规范）
- **外部依赖**：`obsidian`、`electron`、`@codemirror/*`、`@lezer/*`
- **格式**：IIFE（`format: 'iife'`）
- **输出**：`main.js`

### 打包发布

**手动安装**：将 `main.js`、`manifest.json`、`styles.css` 复制到 `.obsidian/plugins/lan-sync/`

**社区发布**：
1. 创建 GitHub 仓库，推送代码
2. 创建 Release，上传三个产物文件
3. 向 [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 提交 PR

## 依赖

| 依赖 | 用途 |
|------|------|
| `obsidian` | Obsidian API |
| `ws` | WebSocket Server/Client（桌面端） |

## License

MIT
