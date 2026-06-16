import express from "express";
import {
  HTTP_PORT,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  RERANK_PATHS,
} from "./config.js";
import { validateRequest, rerank } from "./adapter.js";
import { createLogger } from "./logger.js";
import { recordRerank, getStats, getRecent, closeTelemetry } from "./telemetry.js";
import type { RerankRequest } from "./adapter.js";

const log = createLogger("reranker");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── POST /v1/rerank ── 特殊处理：转换请求体 → Ollama /api/chat ─

function handleRerank(req: express.Request, res: express.Response) {
  const t0 = performance.now();

  const err = validateRequest(req.body);
  if (err) {
    log.warn({ err }, "invalid rerank request");
    res.status(400).json({ error: err });
    return;
  }

  const body = req.body as RerankRequest;
  const docCount = body.documents.length;

  log.info(
    { query: body.query.slice(0, 120), docs: docCount, path: req.path },
    "rerank request",
  );

  rerank(body, log)
    .then((result) => {
      const duration = Math.round(performance.now() - t0);
      log.info(
        { topScore: result.results[0]?.score, count: result.results.length, duration_ms: duration },
        "rerank completed",
      );
      recordRerank({ duration_ms: duration, doc_count: docCount, status: "ok" });
      res.json(result);
    })
    .catch((err) => {
      const duration = Math.round(performance.now() - t0);
      const message = (err as Error).message;
      log.error({ err: message, duration_ms: duration }, "rerank failed");
      recordRerank({ duration_ms: duration, doc_count: docCount, status: "error", error: message });
      res.status(502).json({ error: `Rerank failed: ${message}` });
    });
}

// 动态注册 rerank 拦截路由
for (const path of RERANK_PATHS) {
  app.post(path, handleRerank);
}

// ── GET /health ───────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ollama: OLLAMA_BASE_URL, model: OLLAMA_MODEL });
});

// ── GET /admin/stats ──────────────────────────────────────────

app.get("/admin/stats", (_req, res) => {
  const stats = getStats();
  const recent = getRecent(10);
  res.json({ stats, recent });
});

// ── 透明代理 — 其他所有请求直接转发到 Ollama ─────────────────

app.all("*", async (req, res) => {
  const targetUrl = `${OLLAMA_BASE_URL}${req.originalUrl}`;

  try {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === "host" || key === "connection" || key === "transfer-encoding") continue;
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }

    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? JSON.stringify(req.body)
        : undefined;

    if (body) {
      headers["content-length"] = String(Buffer.byteLength(body));
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (key === "transfer-encoding" || key === "connection") continue;
      res.setHeader(key, value);
    }

    const responseBody = await upstream.text();
    res.send(responseBody);

    log.info(
      { method: req.method, url: req.originalUrl, status: upstream.status },
      "proxy response",
    );
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err: message, url: req.originalUrl }, "proxy error");
    res.status(502).json({ error: `Proxy error: ${message}` });
  }
});

// ── 启动 ──────────────────────────────────────────────────────

app.listen(HTTP_PORT, "0.0.0.0", () => {
  log.info(
    { port: HTTP_PORT, ollama: OLLAMA_BASE_URL, model: OLLAMA_MODEL },
    "adapter started (rerank + transparent proxy)",
  );
  console.log("═══════════════════════════════════════════");
  console.log("  Rerank Adapter 已启动");
  console.log(`  端口: ${HTTP_PORT}`);
  console.log(`  上游: ${OLLAMA_BASE_URL}`);
  console.log(`  Rerank 模型: ${OLLAMA_MODEL}`);
  console.log("═══════════════════════════════════════════");
  console.log("  模式: 透明代理");
  console.log("    /v1/rerank     → 适配层处理");
  console.log("    /v1/models      → 透传到 Ollama");
  console.log("    /admin/stats    → 遥测统计");
  console.log("═══════════════════════════════════════════");
});

// ── 退出清理 ──────────────────────────────────────────────────

process.on("SIGINT", () => {
  closeTelemetry();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeTelemetry();
  process.exit(0);
});
