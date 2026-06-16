import express from "express";
import http from "node:http";
import { HTTP_PORT, OLLAMA_BASE_URL, OLLAMA_MODEL } from "./config.js";
import { validateRequest, rerank } from "./adapter.js";
import { createLogger } from "./logger.js";
import type { RerankRequest } from "./adapter.js";

const log = createLogger("reranker");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── POST /v1/rerank ── 特殊处理：转换请求体 → Ollama /api/chat ─

app.post("/v1/rerank", async (req, res) => {
  const err = validateRequest(req.body);
  if (err) {
    log.warn({ err }, "invalid rerank request");
    res.status(400).json({ error: err });
    return;
  }

  const body = req.body as RerankRequest;

  log.info(
    { query: body.query.slice(0, 120), docs: body.documents.length },
    "rerank request",
  );

  try {
    const result = await rerank(body, log);
    log.info(
      { topScore: result.results[0]?.score, count: result.results.length },
      "rerank completed",
    );
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err: message }, "rerank failed");
    res.status(502).json({ error: `Rerank failed: ${message}` });
  }
});

// ── GET /health ───────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ollama: OLLAMA_BASE_URL, model: OLLAMA_MODEL });
});

// ── 透明代理 — 其他所有请求直接转发到 Ollama ─────────────────

app.all("*", async (req, res) => {
  const targetUrl = `${OLLAMA_BASE_URL}${req.originalUrl}`;

  log.info(
    { method: req.method, url: req.originalUrl, target: targetUrl },
    "proxy request",
  );

  try {
    // 构建转发请求
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // 跳过 hop-by-hop 头
      if (
        key === "host" ||
        key === "connection" ||
        key === "transfer-encoding"
      ) {
        continue;
      }
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

    // 回传状态码和头
    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (key === "transfer-encoding" || key === "connection") continue;
      res.setHeader(key, value);
    }

    // 回传响应体
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
  console.log("    /v1/rerank     → 适配层处理（转换后调 Ollama /api/chat）");
  console.log("    /v1/models      → 透传到 Ollama");
  console.log("    /v1/chat/*      → 透传到 Ollama");
  console.log("    其他            → 透传到 Ollama");
  console.log("═══════════════════════════════════════════");
  console.log("  Cherry Studio 配置:");
  console.log(`    API 地址: http://localhost:${HTTP_PORT}`);
  console.log("═══════════════════════════════════════════");
});
