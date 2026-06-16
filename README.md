# forward-reranker-port

Rerank API 适配层 —— 将 Cherry Studio 的 `/v1/rerank` 请求转发到 Ollama 的 `/api/chat`，用本地 Ollama 模型实现 Rerank。

## 背景

Cherry Studio 支持配置 Reranker API（知识库检索重排序），遵循 `/v1/rerank` 事实标准。但 Ollama 原生**不支持** Rerank API，只提供 `/api/chat` 等 LLM 端点。

本项目在两者之间架一个适配层：

```
Cherry Studio                 本服务(:11435)                 Ollama(:11434)
┌──────────┐   POST /v1/rerank  ┌──────────────┐   /api/chat   ┌──────────┐
│  Rerank   │ ────────────────► │  适配层       │ ────────────► │  qwen3-  │
│  Request  │ ◄──────────────── │  (Express)    │ ◄──────────── │  rerank  │
│           │   JSON Response   │              │   分数文本     │  -8b     │
└──────────┘                    └──────────────┘               └──────────┘
```

适配层做的事：
1. 接收标准 `/v1/rerank` 请求 (`query` + `documents[]`)
2. 为每个文档构造 prompt，逐条请求 Ollama `/api/chat`
3. 从 Ollama 返回的文本中解析数字分数
4. 收集所有分数 → 排序 → 组装为标准 Rerank 响应返回

## 快速开始

```bash
# 安装依赖
pnpm install

# 编译
pnpm build

# 启动（需先确保 Ollama 在 localhost:11434 运行）
pnpm start
```

默认端口 **11435**（Ollama 为 11434，适配层紧邻其后）。

所有配置集中在 `.env` 文件中（已提交到 git，作为项目默认值）：

```bash
# .env — 默认配置
PORT=11435
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3-rerank-8b
OLLAMA_TIMEOUT_MS=60000
MAX_CONCURRENCY=4
```

本地覆盖请创建 `.env.local`（不会被 git 跟踪）。

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `11435` | 适配层 HTTP 端口（Cherry Studio 填这个） |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_MODEL` | `qwen3-rerank-8b` | Ollama 中用于评分的模型 |
| `OLLAMA_TIMEOUT_MS` | `60000` | 单次 Ollama 请求超时 (ms) |
| `MAX_CONCURRENCY` | `4` | 最大并发 Ollama 请求数 |

## Cherry Studio 配置

1. 打开 Cherry Studio → 设置 → 模型服务
2. 添加自定义提供商，类型选择 Rerank
3. API 地址填写：`http://localhost:11435`
4. Cherry Studio 会自动追加 `/v1/rerank`，最终请求 `http://localhost:11435/v1/rerank`

## 测试

```bash
pnpm test
```

测试覆盖：
- 请求体验证（缺失字段、长度限制、类型检查）
- 响应结构验证（排序、top_n 截断）
- Ollama 异常响应容错（503、非数字输出）

## 开机自启（NSSM）

### 安装

以**管理员身份**运行：

```powershell
.\scripts\nssm\install.ps1
```

前提：`nssm.exe` 需在 PATH 中，或放在 `scripts/nssm/` 下。安装方式：

```powershell
choco install nssm          # 推荐
# 或手动下载：https://nssm.cc/download
```

### 手动安装

```batch
REM 确认 node 和 nssm 可用
where node
where nssm

REM 创建服务
nssm install forward-reranker "C:\Program Files\nodejs\node.exe" dist\server.js

REM 配置
nssm set forward-reranker DisplayName "Forward Reranker Adapter"
nssm set forward-reranker Description "Rerank API adapter (port 11435)"
nssm set forward-reranker AppDirectory G:\GitHub\forward-reranker-port
nssm set forward-reranker Start SERVICE_AUTO_START
nssm set forward-reranker AppExit Default Restart
nssm set forward-reranker AppThrottle 5000
nssm set forward-reranker AppStdout G:\GitHub\forward-reranker-port\logs\forward-reranker.log
nssm set forward-reranker AppStderr G:\GitHub\forward-reranker-port\logs\forward-reranker-error.log
nssm set forward-reranker AppRotateFiles 1
nssm set forward-reranker AppRotateSeconds 86400
nssm set forward-reranker AppRotateBytes 1048576
nssm set forward-reranker AppEnvironmentExtra "NODE_ENV=production"
nssm set forward-reranker AppEnvironmentExtra "PORT=11435"

REM 启动
nssm start forward-reranker
```

### 日常管理

```powershell
.\scripts\nssm\status.ps1    # 状态总览
nssm restart forward-reranker # 重启
nssm stop forward-reranker    # 停止
services.msc                  # 图形化管理
```

## 项目结构

```
forward-reranker-port/
  .env                # 默认配置（已提交，可被环境变量覆盖）
  src/
    server.ts          # Express 服务入口
    adapter.ts         # Rerank 核心逻辑（请求转换、并发打分、排序）
    config.ts          # 加载 .env + 导出配置常量
  tests/
    adapter.test.ts    # 单元测试
  scripts/
    nssm/              # Windows 服务管理（NSSM）
  dist/                # tsc 编译产物
  logs/                # 运行日志
```

## 为什么不用 Nginx 代理？

Nginx 只能重写 URL 路径，**无法转换 JSON 请求体**。Cherry Studio 发的 Rerank 请求体是：

```json
{ "query": "...", "documents": ["..."] }
```

而 Ollama `/api/chat` 期望的是：

```json
{ "model": "...", "messages": [{"role": "user", "content": "..."}] }
```

格式完全不同，必须通过代码层转换。本适配层即承担这个角色。

## 局限性

- **速度**：N 个文档需要 N 次 Ollama 请求（通过并发控制缓解，默认 4 路并发）
- **精度**：用 LLM 文本输出做评分，不如专用 Cross-Encoder 模型精确
- **依赖**：需要 Ollama 服务在本地运行

对于大多数场景（10-20 个文档候选），延迟和精度都足够实用。如果文档量大或对精度有严格要求，建议使用在线专用 Rerank API（如硅基流动、Cohere）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | Express 4 |
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.7 |
| 测试 | Vitest |
| 开机自启 | NSSM（Windows 服务） |
| 下游依赖 | Ollama（本地 LLM 推理） |

## License

MIT
