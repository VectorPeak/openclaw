// Soft chunking tests cover paragraph-preferred block reply splits and fenced
// code preservation during streamed assistant output.
import { describe, expect, it, vi } from "vitest";
import {
  createParagraphChunkedBlockReplyHarness,
  emitAssistantTextDeltaAndEnd,
} from "./embedded-agent-subscribe.e2e-harness.js";

function blockReplyTexts(onBlockReply: ReturnType<typeof vi.fn>): string[] {
  // Helper extracts just user-visible text from emitted block reply payloads.
  return onBlockReply.mock.calls.map(([payload]) => (payload as { text?: string }).text ?? "");
}

describe("subscribeEmbeddedAgentSession", () => {
  it("streams soft chunks with paragraph preference", () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createParagraphChunkedBlockReplyHarness({
      onBlockReply,
      chunking: {
        minChars: 5,
        maxChars: 25,
      },
    });

    const text = "First block line\n\nSecond block line";

    emitAssistantTextDeltaAndEnd({ emit, text });

    expect(onBlockReply).toHaveBeenCalledTimes(2);
    expect(blockReplyTexts(onBlockReply)).toEqual(["First block line", "Second block line"]);
    expect(subscription.assistantTexts).toEqual(["First block line", "Second block line"]);
  });
  it("avoids splitting inside fenced code blocks", () => {
    const onBlockReply = vi.fn();
    const { emit } = createParagraphChunkedBlockReplyHarness({
      onBlockReply,
      chunking: {
        minChars: 5,
        maxChars: 25,
      },
    });

    const text = "Intro\n\n```bash\nline1\nline2\n```\n\nOutro";

    emitAssistantTextDeltaAndEnd({ emit, text });

    expect(onBlockReply).toHaveBeenCalledTimes(3);
    expect(blockReplyTexts(onBlockReply)).toEqual(["Intro", "```bash\nline1\nline2\n```", "Outro"]);
  });

  it("avoids splitting inside markdown tables", () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createParagraphChunkedBlockReplyHarness({
      onBlockReply,
      chunking: {
        minChars: 5,
        maxChars: 25,
      },
    });

    const table = ["| Name | Value |", "| --- | --- |", "| Alpha | One |", "| Beta | Two |"].join(
      "\n",
    );
    const text = ["Intro", "", table, "", "Outro"].join("\n");

    emitAssistantTextDeltaAndEnd({ emit, text });

    expect(onBlockReply).toHaveBeenCalledTimes(3);
    expect(onBlockReply.mock.calls[0][0].text).toBe("Intro");
    expect(onBlockReply.mock.calls[1][0].text).toBe(table);
    expect(onBlockReply.mock.calls[2][0].text).toBe("Outro");
    expect(subscription.assistantTexts).toEqual(["Intro", table, "Outro"]);
  });
});
