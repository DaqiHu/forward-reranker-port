import {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS,
  MAX_CONCURRENCY,
  DEFAULT_SCORE,
  MAX_DOCUMENTS,
} from "./config.js";

// ── 类型 ──────────────────────────────────────────────────────

/** Cherry Studio 发送的 Rerank 请求体 */
export interface RerankRequest {
  query: string;
  documents: string[];
  top_n?: number;
}

/** Rerank API 标准响应 */
export interface RerankResponse {
  results: { index: number; score: number }[];
}

/** Ollama /api/chat 请求体 */
interface OllamaChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream: false;
}

/** Ollama /api/chat 响应体 */
interface OllamaChatResponse {
  message: { role: string; content: string };
}

// ── 提示词 ────────────────────────────────────────────────────

const RERANK_PROMPT = [
  "判断以下文档与查询的相关性，只输出数字分数（0-1），",
  "分数越高越相关。只输出数字，不要输出任何其他字符。",
  "查询: {query}",
  "文档: {document}",
  "相关分数:",
].join("\n");

function buildPrompt(query: string, document: string): string {
  return RERANK_PROMPT.replace("{query}", query).replace(
    "{document}",
    document,
  );
}

// ── 分数解析 ──────────────────────────────────────────────────

/**
 * 从 Ollama 返回的文本中提取分数。
 * 容错：去除空白、尝试直接 parseFloat，失败则返回默认值。
 */
function parseScore(raw: string): number {
  const trimmed = raw.trim();
  // 匹配第一个数字（支持 0.5 .5 1 1.0 等格式）
  const match = trimmed.match(/(\d*\.?\d+)/);
  if (match) {
    const n = parseFloat(match[1]);
    if (!isNaN(n)) {
      return Math.max(0, Math.min(1, n)); // clamp [0, 1]
    }
  }
  return DEFAULT_SCORE;
}

// ── Ollama 调用 ───────────────────────────────────────────────

/**
 * 向 Ollama 发送单次 chat 请求，获取一个文档的相关性分数。
 */
async function scoreDocument(
  query: string,
  document: string,
  signal?: AbortSignal,
): Promise<number> {
  const prompt = buildPrompt(query, document);
  const body: OllamaChatRequest = {
    model: OLLAMA_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  const resp = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Ollama 返回 ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`,
    );
  }

  const data = (await resp.json()) as OllamaChatResponse;
  return parseScore(data.message?.content ?? "");
}

// ── 并发控制 ──────────────────────────────────────────────────

/**
 * 带并发限制的异步映射。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── 公开 API ──────────────────────────────────────────────────

/**
 * 验证 Rerank 请求体。
 * 返回错误消息字符串，或 null 表示合法。
 */
export function validateRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;

  if (typeof b.query !== "string" || b.query.trim().length === 0) {
    return 'Missing or invalid "query" field';
  }
  if (!Array.isArray(b.documents) || b.documents.length === 0) {
    return 'Missing or empty "documents" array';
  }
  if (b.documents.length > MAX_DOCUMENTS) {
    return `Too many documents (max ${MAX_DOCUMENTS})`;
  }
  if (
    b.top_n !== undefined &&
    (typeof b.top_n !== "number" || b.top_n < 1)
  ) {
    return '"top_n" must be a positive integer';
  }
  return null;
}

/** 日志接口（与 pino.Logger 兼容的最小面） */
export interface RerankLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: RerankLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
};

/**
 * 执行 Rerank：对每个文档打分、排序、返回 top_n。
 *
 * @param log 可选 logger（pino 或兼容接口），用于结构化日志
 */
export async function rerank(
  request: RerankRequest,
  log: RerankLogger = noopLogger,
  signal?: AbortSignal,
): Promise<RerankResponse> {
  const { query, documents, top_n } = request;
  const limit = top_n ?? documents.length;

  // 并发打分
  const scores = await mapWithConcurrency(
    documents,
    async (doc, idx) => {
      try {
        const s = await scoreDocument(query, doc, signal);
        return { index: idx, score: s };
      } catch (err) {
        // 单个文档失败不中断全部，返回默认分
        const message = (err as Error).message;
        log.error({ index: idx, err: message }, "document scoring failed");
        return { index: idx, score: DEFAULT_SCORE };
      }
    },
    MAX_CONCURRENCY,
  );

  // 按分数降序排列
  scores.sort((a, b) => b.score - a.score);

  return { results: scores.slice(0, limit) };
}
