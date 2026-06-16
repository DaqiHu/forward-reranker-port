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
const eventsPath = path.join(dataDir, "telemetry.jsonl");

// ── 类型 ──────────────────────────────────────────────────────

export interface RerankEvent {
  timestamp: string;
  duration_ms: number;
  doc_count: number;
  status: "ok" | "error";
  error?: string;
}

// ── 写入 ──────────────────────────────────────────────────────

const writeStream = fs.createWriteStream(eventsPath, { flags: "a" });

/** 记录一次 Rerank 请求（追加一行 JSON 到 telemetry.jsonl） */
export function recordRerank(ev: Omit<RerankEvent, "timestamp">): void {
  const entry: RerankEvent = {
    timestamp: new Date().toISOString(),
    ...ev,
  };
  writeStream.write(JSON.stringify(entry) + "\n");
}

// ── 读取 ──────────────────────────────────────────────────────

function readAll(): RerankEvent[] {
  if (!fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as RerankEvent);
}

// ── 统计 ──────────────────────────────────────────────────────

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
  const all = readAll();
  if (all.length === 0) {
    return { total: 0, ok: 0, error: 0, avg_ms: 0, p50_ms: 0, p95_ms: 0, avg_docs: 0, last_24h: 0 };
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const okEvents = all.filter((e) => e.status === "ok");
  const durations = okEvents.map((e) => e.duration_ms).sort((a, b) => a - b);

  const total = all.length;
  const okCount = okEvents.length;
  const errorCount = total - okCount;
  const avgMs = okCount > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / okCount) : 0;
  const avgDocs = total > 0 ? Math.round((all.reduce((a, e) => a + e.doc_count, 0) / total) * 10) / 10 : 0;

  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const last24h = all.filter((e) => new Date(e.timestamp) >= dayAgo).length;

  return {
    total,
    ok: okCount,
    error: errorCount,
    avg_ms: avgMs,
    p50_ms: p50,
    p95_ms: p95,
    avg_docs: avgDocs,
    last_24h: last24h,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/** 最近 N 条记录 */
export function getRecent(limit = 20): RerankEvent[] {
  const all = readAll();
  return all.slice(-limit).reverse();
}

/** 关闭写入流（进程退出时调用） */
export function closeTelemetry(): void {
  writeStream.end();
}
