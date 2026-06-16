import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { DATA_DIR, NODE_ENV } from "./config.js";

// ── 路径 ──────────────────────────────────────────────────────

function resolveDataDir(): string {
  if (DATA_DIR) return path.resolve(DATA_DIR);

  const isProd = NODE_ENV === "production";
  if (isProd) {
    const programData =
      process.env.ProgramData ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(programData, "forward-reranker-port");
  }
  return path.join(process.cwd(), "data");
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "telemetry.db");

// ── 数据库 ────────────────────────────────────────────────────

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS rerank_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT    NOT NULL,
    duration_ms INTEGER NOT NULL,
    doc_count  INTEGER NOT NULL,
    status     TEXT    NOT NULL,
    error      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rerank_events_ts
    ON rerank_events(timestamp);
`);

const insertStmt = db.prepare(`
  INSERT INTO rerank_events (timestamp, duration_ms, doc_count, status, error)
  VALUES (?, ?, ?, ?, ?)
`);

// ── 公开 API ──────────────────────────────────────────────────

export interface RerankEvent {
  duration_ms: number;
  doc_count: number;
  status: "ok" | "error";
  error?: string;
}

/** 记录一次 Rerank 请求 */
export function recordRerank(ev: RerankEvent): void {
  insertStmt.run(
    new Date().toISOString(),
    ev.duration_ms,
    ev.doc_count,
    ev.status,
    ev.error ?? null,
  );
}

/** 查询统计 */
export interface RerankStats {
  total: number;
  ok: number;
  error: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  avg_docs: number;
  last_24h: number;
}

export function getStats(): RerankStats {
  const row = db
    .prepare(
      `SELECT
        COUNT(*)              AS total,
        SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
        ROUND(AVG(duration_ms), 0) AS avg_ms,
        ROUND(AVG(doc_count), 1)   AS avg_docs,
        SUM(CASE WHEN timestamp >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last_24h
      FROM rerank_events`,
    )
    .get() as Record<string, number> | undefined;

  // 用子查询取百分位（SQLite 没有 percentile 函数）
  const p50 = db
    .prepare(
      `SELECT duration_ms FROM rerank_events
       WHERE status = 'ok'
       ORDER BY duration_ms
       LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.5 AS INTEGER) FROM rerank_events WHERE status = 'ok')`,
    )
    .get() as { duration_ms: number } | undefined;

  const p95 = db
    .prepare(
      `SELECT duration_ms FROM rerank_events
       WHERE status = 'ok'
       ORDER BY duration_ms
       LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM rerank_events WHERE status = 'ok')`,
    )
    .get() as { duration_ms: number } | undefined;

  return {
    total: row?.total ?? 0,
    ok: row?.ok ?? 0,
    error: row?.error ?? 0,
    avg_ms: row?.avg_ms ?? 0,
    p50_ms: p50?.duration_ms ?? 0,
    p95_ms: p95?.duration_ms ?? 0,
    avg_docs: row?.avg_docs ?? 0,
    last_24h: row?.last_24h ?? 0,
  };
}

/** 最近 N 条记录 */
export function getRecent(limit = 20): RerankEvent[] {
  return db
    .prepare(
      `SELECT duration_ms, doc_count, status, error
       FROM rerank_events
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as RerankEvent[];
}

/** 关闭数据库（进程退出时调用） */
export function closeTelemetry(): void {
  db.close();
}
