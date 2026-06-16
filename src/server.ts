import express from "express";
import { HTTP_PORT, OLLAMA_BASE_URL, OLLAMA_MODEL } from "./config.js";
import { validateRequest, rerank } from "./adapter.js";
import { createLogger } from "./logger.js";
import type { RerankRequest } from "./adapter.js";

const log = createLogger("reranker");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── POST /v1/rerank ──────────────────────────────────────────

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

// ── 启动 ──────────────────────────────────────────────────────

app.listen(HTTP_PORT, "0.0.0.0", () => {
  log.info(
    { port: HTTP_PORT, ollama: OLLAMA_BASE_URL, model: OLLAMA_MODEL },
    "rerank adapter started",
  );
  console.log("═══════════════════════════════════════════");
  console.log("  Rerank Adapter 已启动");
  console.log(`  端口: ${HTTP_PORT}`);
  console.log(`  Ollama: ${OLLAMA_BASE_URL}`);
  console.log(`  模型: ${OLLAMA_MODEL}`);
  console.log("═══════════════════════════════════════════");
  console.log("  Cherry Studio 配置:");
  console.log(`    API 地址: http://localhost:${HTTP_PORT}`);
  console.log("    (使用 /v1/rerank 端点)");
  console.log("═══════════════════════════════════════════");
});
