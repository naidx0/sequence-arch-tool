import { describe, expect, it } from "vitest";
import { publishedContextWindow } from "./publishedContextWindow";

describe("publishedContextWindow", () => {
  it("returns vendor windows for Claude / GPT / Gemini ids", () => {
    expect(publishedContextWindow("claude-sonnet-4-20250514")).toBe(200_000);
    expect(publishedContextWindow("gpt-4o")).toBe(128_000);
    expect(publishedContextWindow("gemini-2.5-pro")).toBe(1_000_000);
  });

  it("returns OpenRouter deepseek published window when probe is unavailable", () => {
    expect(publishedContextWindow("deepseek/deepseek-v4-flash-0731")).toBe(128_000);
  });

  it("returns null for unknown / local ids so Ollama probe stays authoritative", () => {
    expect(publishedContextWindow("llama3.2:latest")).toBeNull();
    expect(publishedContextWindow("")).toBeNull();
  });
});
