/**
 * 加载 .env 文件（手动解析，兼容所有 Node 版本）。
 * .env.local 不会被加载——它只用于本地覆盖，已加入 .gitignore。
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // strip surrounding quotes
    if ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * 服务配置常量。所有值均可通过环境变量覆盖（见 .env 默认值）。
 */

/** 运行模式 */
export const NODE_ENV = process.env.NODE_ENV || "development";

/** 适配层 HTTP 端口（Cherry Studio 填这个） */
export const HTTP_PORT = Number(process.env.PORT) || 11435;

/** Ollama 服务地址 */
export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";

/** Ollama 中用于 Rerank 的模型名称 */
export const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL || "qwen3-rerank-8b";

/** Ollama chat API 路径 */
export const OLLAMA_CHAT_PATH =
  process.env.OLLAMA_CHAT_PATH || "/api/chat";

/** 拦截为 Rerank 的路径列表（逗号分隔） */
export const RERANK_PATHS =
  (process.env.RERANK_PATHS || "/v1/rerank,/api/v1/rerank")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/** 单次 Ollama 请求超时 (ms) */
export const OLLAMA_TIMEOUT_MS =
  Number(process.env.OLLAMA_TIMEOUT_MS) || 60_000;

/** 最大并发 Ollama 请求数 */
export const MAX_CONCURRENCY =
  Number(process.env.MAX_CONCURRENCY) || 4;

/** 日志目录 — 未设置时由 logger.ts 根据 NODE_ENV 自动选择 */
export const LOGS_DIR = process.env.LOGS_DIR || "";

/** 数据目录（telemetry.db 等） — 未设置时自动选择 */
export const DATA_DIR = process.env.DATA_DIR || "";

/** 分数解析失败时的默认值 */
export const DEFAULT_SCORE = 0.0;

/** Rerank 单次最大文档数 */
export const MAX_DOCUMENTS = 100;
