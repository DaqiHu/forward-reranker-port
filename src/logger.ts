import pino from "pino";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { LOGS_DIR, NODE_ENV } from "./config.js";

/**
 * pino logger 工厂。
 *
 * 日志目录优先级：
 *   1. LOGS_DIR 环境变量（或 .env 中设定）
 *   2. 未设时 — prod 用 %ProgramData%/forward-reranker-port/logs
 *               dev  用 ./logs（项目本地，已 gitignore）
 *
 * 双输出：
 *   - stdout（pino-pretty 彩色）
 *   - 文件轮转（pino-roll，按天切割，info 保留 14 天，error 保留 30 天）
 */
export function createLogger(name: string): pino.Logger {
  const logDir = resolveLogDir();
  fs.mkdirSync(logDir, { recursive: true });

  const isDev = NODE_ENV !== "production";
  const level = isDev ? "debug" : "info";

  return pino(
    { name, level },
    pino.transport({
      targets: [
        {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          level,
        },
        {
          target: "pino-roll",
          options: {
            file: path.join(logDir, name),
            frequency: "daily",
            limit: { count: 14 },
            extension: ".log",
          },
          level: "info",
        },
        {
          target: "pino-roll",
          options: {
            file: path.join(logDir, `${name}-error`),
            frequency: "daily",
            limit: { count: 30 },
            extension: ".log",
          },
          level: "error",
        },
      ],
    }),
  );
}

/**
 * 解析日志目录。
 */
function resolveLogDir(): string {
  // 1. 环境变量显式覆盖（最高优先级）
  if (LOGS_DIR) {
    return path.resolve(LOGS_DIR);
  }

  // 2. prod: %ProgramData% (C:\ProgramData\...) — 系统级应用数据目录
  //    dev:  项目下的 ./logs
  const isProd = NODE_ENV === "production";
  if (isProd) {
    // %ProgramData% 通常为 C:\ProgramData，是 Local Service 用户也可写的共享位置
    const programData = process.env.ProgramData || path.join(os.homedir(), "AppData", "Local");
    return path.join(programData, "forward-reranker-port", "logs");
  }

  return path.join(process.cwd(), "logs");
}

export type { Logger } from "pino";
