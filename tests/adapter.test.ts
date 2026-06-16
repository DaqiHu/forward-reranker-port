import { describe, it, expect } from "vitest";
import { validateRequest, rerank } from "../src/adapter.js";
import type { RerankRequest } from "../src/adapter.js";

// ── validateRequest ─────────────────────────────────────────────

describe("validateRequest", () => {
  it("rejects non-object body", () => {
    expect(validateRequest(null)).toBe("Request body must be a JSON object");
    expect(validateRequest("string")).toBe("Request body must be a JSON object");
    expect(validateRequest(42)).toBe("Request body must be a JSON object");
  });

  it("rejects missing query", () => {
    expect(validateRequest({ documents: ["a"] })).toContain("query");
  });

  it("rejects empty query", () => {
    expect(validateRequest({ query: "  ", documents: ["a"] })).toContain(
      "query",
    );
  });

  it("rejects missing documents", () => {
    expect(validateRequest({ query: "test" })).toContain("documents");
  });

  it("rejects empty documents array", () => {
    expect(validateRequest({ query: "test", documents: [] })).toContain(
      "documents",
    );
  });

  it("rejects too many documents", () => {
    const docs = Array.from({ length: 101 }, (_, i) => `doc ${i}`);
    expect(validateRequest({ query: "test", documents: docs })).toContain(
      "Too many documents",
    );
  });

  it("rejects invalid top_n", () => {
    expect(
      validateRequest({ query: "test", documents: ["a"], top_n: 0 }),
    ).toContain("top_n");
    expect(
      validateRequest({ query: "test", documents: ["a"], top_n: -1 }),
    ).toContain("top_n");
  });

  it("accepts valid request", () => {
    expect(
      validateRequest({ query: "test", documents: ["a", "b"] }),
    ).toBeNull();
  });

  it("accepts valid request with top_n", () => {
    expect(
      validateRequest({
        query: "test",
        documents: ["a", "b", "c"],
        top_n: 2,
      }),
    ).toBeNull();
  });

  it("accepts 100 documents (max)", () => {
    const docs = Array.from({ length: 100 }, (_, i) => `doc ${i}`);
    expect(validateRequest({ query: "test", documents: docs })).toBeNull();
  });
});

// ── rerank (unit-level, mocking fetch) ──────────────────────────

describe("rerank", () => {
  it("returns results with correct structure", async () => {
    // Mock fetch to return fixed scores
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(
        (init?.body as string) ?? "{}",
      ) as { messages: { content: string }[] };
      const prompt = body.messages[0].content;

      // Return score based on document content for deterministic test
      let score = 0.5;
      if (prompt.includes("highly relevant")) score = 0.95;
      else if (prompt.includes("somewhat")) score = 0.6;
      else if (prompt.includes("irrelevant")) score = 0.1;

      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: String(score) },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    try {
      const result = await rerank({
        query: "test query",
        documents: ["highly relevant doc", "somewhat relevant", "irrelevant"],
      });

      expect(result.results).toHaveLength(3);
      // Should be sorted descending
      expect(result.results[0].score).toBeGreaterThanOrEqual(
        result.results[1].score,
      );
      expect(result.results[1].score).toBeGreaterThanOrEqual(
        result.results[2].score,
      );
      // All indices should be present
      const indices = result.results.map((r) => r.index).sort();
      expect(indices).toEqual([0, 1, 2]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("respects top_n parameter", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: "0.5" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    try {
      const result = await rerank({
        query: "test",
        documents: ["a", "b", "c", "d", "e"],
        top_n: 3,
      });
      expect(result.results).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Ollama returning non-numeric response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          message: {
            role: "assistant",
            content: "This document is very relevant!",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    try {
      const result = await rerank({
        query: "test",
        documents: ["doc1"],
      });
      expect(result.results).toHaveLength(1);
      // Should fall back to default score (0.0)
      expect(result.results[0].score).toBe(0.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Ollama HTTP error without crashing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response("Service Unavailable", { status: 503 });
    }) as typeof globalThis.fetch;

    try {
      const result = await rerank({
        query: "test",
        documents: ["doc1"],
      });
      // Should not throw — individual doc failure returns default
      expect(result.results).toHaveLength(1);
      expect(result.results[0].score).toBe(0.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
