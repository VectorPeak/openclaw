import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import { describe, expect, it } from "vitest";
import {
  buildCodexWorkspaceBootstrapContext,
  buildCodexSystemPromptReport,
  getCodexWorkspaceMemoryToolNames,
  readContextEngineThreadBootstrapProjection,
  remapCodexContextFilePath,
  resolveContextEngineBootstrapProjectionDecision,
} from "./attempt-context.js";
import type { CodexDynamicToolSpec } from "./protocol.js";
import type { CodexAppServerContextEngineBinding } from "./session-binding.js";

function defineThrowingProperty(record: Record<string, unknown>, key: string, message: string) {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error(message);
    },
  });
}

describe("Codex app-server attempt context", () => {
  it("returns a run context report without deferred Codex dynamic tool schemas", () => {
    const tools = [
      {
        name: "message",
        description: "Send a message.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
        },
      },
      {
        name: "web_search",
        description: "Search the web.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        deferLoading: true,
      },
    ] as CodexDynamicToolSpec[];

    const report = buildCodexSystemPromptReport({
      attempt: {
        sessionId: "session-1",
        provider: "codex",
        modelId: "gpt-5.4-codex",
      } as EmbeddedRunAttemptParams,
      sessionKey: "agent:main:session-1",
      workspaceDir: path.join("tmp", "workspace"),
      developerInstructions: "test developer instructions",
      workspaceBootstrapContext: {
        bootstrapFiles: [],
        contextFiles: [],
        promptContextFiles: [],
        developerInstructionFiles: [],
        heartbeatReferenceFiles: [],
      },
      skillsPrompt: "",
      tools,
    });

    expect(report.source).toBe("run");
    expect(report.provider).toBe("codex");
    expect(report.model).toBe("gpt-5.4-codex");
    expect(report.systemPrompt.chars).toBeGreaterThan(0);
    expect(report.systemPrompt.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.skills.hash).toMatch(/^[a-f0-9]{64}$/u);

    const message = report.tools.entries.find((tool) => tool.name === "message");
    const webSearch = report.tools.entries.find((tool) => tool.name === "web_search");
    expect(message?.schemaChars).toBeGreaterThan(0);
    expect(message?.summaryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(message?.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(webSearch?.schemaChars).toBe(0);
    expect(webSearch?.summaryHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(webSearch?.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.tools.schemaChars).toBe(message?.schemaChars);
  });

  it("keeps MEMORY.md injected when sandbox effective workspace differs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memory-workspace-"));
    const sandboxWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-memory-sandbox-"));
    const memorySummary = "Sandboxed turns need bounded memory fallback.";
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), memorySummary);

    const context = await buildCodexWorkspaceBootstrapContext({
      params: {
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        config: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        },
      } as EmbeddedRunAttemptParams,
      resolvedWorkspace: workspaceDir,
      effectiveWorkspace: sandboxWorkspaceDir,
      sessionKey: "agent:main:session-1",
      sessionAgentId: "main",
      memoryToolNames: ["memory_search", "memory_get"],
    });

    expect(context.memoryReferenceFiles).toEqual([]);
    expect(context.promptContext).toContain(memorySummary);
    expect(context.memoryToolRouted).toBe(false);
  });

  it("reports unreadable synthetic Codex dynamic tool schemas without throwing", () => {
    const properties: Record<string, unknown> = {};
    defineThrowingProperty(properties, "payload", "fuzzplugin tool schema read failed");
    const anyOf: unknown[] = [{}];
    defineThrowingProperty(
      anyOf as unknown as Record<string, unknown>,
      "0",
      "mockplugin schema branch failed",
    );
    const schema = { type: "object", properties, anyOf };

    const report = buildCodexSystemPromptReport({
      attempt: {
        sessionId: "session-1",
        provider: "codex",
        modelId: "gpt-5.4-codex",
      } as EmbeddedRunAttemptParams,
      sessionKey: "agent:main:session-1",
      workspaceDir: path.join("tmp", "workspace"),
      developerInstructions: "test developer instructions",
      workspaceBootstrapContext: {
        bootstrapFiles: [],
        contextFiles: [],
        promptContextFiles: [],
        developerInstructionFiles: [],
        heartbeatReferenceFiles: [],
      },
      skillsPrompt: "",
      tools: [
        {
          name: "fuzz_move_report",
          description: "Synthetic tool with an unreadable schema field",
          inputSchema: schema,
        },
      ] as never,
    });

    expect(report.tools.entries[0]).toMatchObject({
      name: "fuzz_move_report",
      propertiesCount: 1,
      schemaChars: 0,
    });
    expect(report.tools.entries[0]?.schemaHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("skips unreadable synthetic Codex dynamic tool names in prompt reports", () => {
    const unreadableNameTool = {
      description: "Synthetic report tool",
      inputSchema: { type: "object", properties: {} },
    };
    defineThrowingProperty(
      unreadableNameTool,
      "name",
      "fuzzplugin prompt report tool name read failed",
    );
    const unreadableDescriptionTool = {
      name: "fuzz_move_report_name",
      inputSchema: { type: "object", properties: {} },
    };
    defineThrowingProperty(
      unreadableDescriptionTool,
      "description",
      "mockplugin prompt report tool description read failed",
    );

    const report = buildCodexSystemPromptReport({
      attempt: {
        sessionId: "session-1",
        provider: "codex",
        modelId: "gpt-5.4-codex",
      } as EmbeddedRunAttemptParams,
      sessionKey: "agent:main:session-1",
      workspaceDir: path.join("tmp", "workspace"),
      developerInstructions: "test developer instructions",
      workspaceBootstrapContext: {
        bootstrapFiles: [],
        contextFiles: [],
        promptContextFiles: [],
        developerInstructionFiles: [],
        heartbeatReferenceFiles: [],
      },
      skillsPrompt: "",
      tools: [
        unreadableNameTool,
        unreadableDescriptionTool,
        {
          name: "message",
          description: "Healthy tool",
          inputSchema: { type: "object", properties: {} },
        },
      ] as never,
    });

    expect(report.tools.entries.map((tool) => tool.name)).toEqual([
      "fuzz_move_report_name",
      "message",
    ]);
    expect(report.tools.entries[0]).toMatchObject({
      name: "fuzz_move_report_name",
      summaryChars: 0,
    });
  });

  it("skips unreadable synthetic Codex dynamic tool names in memory tool routing", () => {
    const unreadableNameTool = {};
    defineThrowingProperty(unreadableNameTool, "name", "fuzzplugin memory tool name read failed");

    expect(
      getCodexWorkspaceMemoryToolNames([
        unreadableNameTool,
        { name: " memory_search " },
        { name: "message" },
      ] as never),
    ).toEqual(["memory_search"]);
  });

  it("remaps Codex bootstrap files under dot-prefixed workspace directories", () => {
    expect(
      remapCodexContextFilePath({
        file: {
          path: "/real/workspace/..context/SOUL.md",
          content: "Soul voice goes here.",
        },
        sourceWorkspaceDir: "/real/workspace",
        targetWorkspaceDir: "/sandbox/workspace",
      }),
    ).toEqual({
      path: "/sandbox/workspace/..context/SOUL.md",
      content: "Soul voice goes here.",
    });
    expect(
      remapCodexContextFilePath({
        file: {
          path: "/outside/SOUL.md",
          content: "outside",
        },
        sourceWorkspaceDir: "/real/workspace",
        targetWorkspaceDir: "/sandbox/workspace",
      }),
    ).toEqual({
      path: "/outside/SOUL.md",
      content: "outside",
    });
  });

  it("reads and compares thread-bootstrap context-engine projections", () => {
    const projection = readContextEngineThreadBootstrapProjection({
      mode: "thread_bootstrap",
      epoch: " epoch-1 ",
      fingerprint: " fingerprint-1 ",
    });
    expect(projection).toEqual({
      mode: "thread_bootstrap",
      epoch: "epoch-1",
      fingerprint: "fingerprint-1",
    });

    const expectedBinding = {
      schemaVersion: 1,
      engineId: "lossless",
      policyFingerprint: "policy-v1",
      projection: {
        schemaVersion: 1,
        mode: "thread_bootstrap",
        epoch: "epoch-1",
        fingerprint: "fingerprint-1",
      },
    } satisfies CodexAppServerContextEngineBinding;
    expect(
      resolveContextEngineBootstrapProjectionDecision({
        startupBinding: {
          threadId: "thread-existing",
          dynamicToolsFingerprint: "same-tools",
          contextEngine: expectedBinding,
        } as never,
        expectedBinding,
        projection: projection!,
        dynamicToolsFingerprint: "same-tools",
      }),
    ).toEqual({
      project: false,
      reason: "matching-thread-bootstrap-binding",
    });
    expect(
      resolveContextEngineBootstrapProjectionDecision({
        startupBinding: {
          threadId: "thread-existing",
          dynamicToolsFingerprint: "old-tools",
          contextEngine: expectedBinding,
        } as never,
        expectedBinding,
        projection: projection!,
        dynamicToolsFingerprint: "new-tools",
      }),
    ).toEqual({
      project: true,
      reason: "dynamic-tools-mismatch",
    });
  });
});
