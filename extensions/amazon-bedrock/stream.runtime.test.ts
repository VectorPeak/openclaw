// Amazon Bedrock tests cover stream plugin behavior.
import { describe, expect, it } from "vitest";
import { streamBedrock, testing } from "./stream.runtime.js";

function bedrockModel(overrides: Record<string, unknown>) {
  return {
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    id: "amazon.nova-micro-v1:0",
    name: "Nova Micro",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  } as never;
}

function signedThinkingContext(modelId: string) {
  const highSurrogate = String.fromCharCode(0xd83d);
  return {
    messages: [
      {
        role: "assistant",
        api: "bedrock-converse-stream",
        provider: "amazon-bedrock",
        model: modelId,
        content: [
          {
            type: "thinking",
            thinking: `private${highSurrogate}reasoning`,
            thinkingSignature: "sig-1",
          },
        ],
      },
    ],
  } as never;
}

describe("Bedrock reasoning replay", () => {
  it("preserves signed reasoning for Claude profile descriptors", () => {
    const modelId =
      "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/profile-abc";
    const messages = testing.convertMessages(
      signedThinkingContext(modelId),
      bedrockModel({
        id: modelId,
        name: "Claude Sonnet application profile",
      }),
      "none",
    );

    expect(messages[0]?.content).toEqual([
      {
        reasoningContent: {
          reasoningText: {
            text: `private${String.fromCharCode(0xd83d)}reasoning`,
            signature: "sig-1",
          },
        },
      },
    ]);
  });

  it("replays signed reasoning as plain text for non-Claude models", () => {
    const modelId = "amazon.nova-micro-v1:0";
    const messages = testing.convertMessages(
      signedThinkingContext(modelId),
      bedrockModel({ id: modelId, name: "Nova Micro" }),
      "none",
    );

    expect(messages[0]?.content).toEqual([{ text: "privatereasoning" }]);
  });
});

describe("Bedrock profile endpoint resolution", () => {
  it("treats request profiles as configured profiles for standard endpoints", () => {
    const endpoint = "https://bedrock-runtime.us-west-2.amazonaws.com";

    expect(testing.hasConfiguredBedrockProfile({ profile: "prod-bedrock" })).toBe(true);
    expect(
      testing.shouldUseExplicitBedrockEndpoint(
        endpoint,
        undefined,
        testing.hasConfiguredBedrockProfile({ profile: "prod-bedrock" }),
      ),
    ).toBe(false);
  });
});

describe("Bedrock stream output identity", () => {
  it("keeps stream errors reachable when setup model metadata is unreadable", async () => {
    const hostileModel = bedrockModel({});
    for (const key of ["provider", "id", "baseUrl"] as const) {
      Object.defineProperty(hostileModel, key, {
        enumerable: true,
        get() {
          throw new Error(`revoked ${key}`);
        },
      });
    }
    let sawPayload = false;

    const stream = streamBedrock(
      hostileModel,
      {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
      } as never,
      {
        onPayload: () => {
          sawPayload = true;
        },
      },
    );

    const result = await stream.result();

    expect(sawPayload).toBe(false);
    expect(result.stopReason).toBe("error");
    expect(result.api).toBe("bedrock-converse-stream");
    expect(result.provider).toBe("unknown");
    expect(result.model).toBe("unknown");
    expect(result.errorMessage).toBe("revoked baseUrl");
  });
});

describe("Bedrock thinking effort mapping", () => {
  it("clamps max effort for Claude models without native max support", () => {
    expect(
      testing.mapThinkingLevelToEffort(
        bedrockModel({
          id: "anthropic.claude-sonnet-4-6-v1:0",
          name: "Claude Sonnet 4.6",
        }),
        "max",
      ),
    ).toBe("high");
  });

  it("preserves max effort for Claude Opus 4.8", () => {
    expect(
      testing.mapThinkingLevelToEffort(
        bedrockModel({
          id: "anthropic.claude-opus-4.8-v1:0",
          name: "Claude Opus 4.8",
        }),
        "max",
      ),
    ).toBe("max");
  });
});

describe("Bedrock tool config snapshots", () => {
  it("clones tool schemas before building AWS payloads", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    };
    const toolConfig = testing.convertToolConfig(
      [
        {
          name: "search",
          description: "Search docs",
          parameters: schema,
        },
      ],
      "auto",
    );

    schema.properties.query.type = "number";
    schema.required.push("limit");

    const inputSchema = toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json;
    expect(inputSchema).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    });
    expect(inputSchema).not.toBe(schema);
    expect((inputSchema as { properties?: unknown }).properties).not.toBe(schema.properties);
  });

  it("skips tools with unreadable fields or cyclic schemas", () => {
    const cyclicSchema: Record<string, unknown> = { type: "object", properties: {} };
    cyclicSchema.properties = { self: cyclicSchema };
    const unreadableTool = Object.defineProperty({}, "name", {
      enumerable: true,
      get() {
        throw new Error("bad tool");
      },
    });

    const toolConfig = testing.convertToolConfig(
      [
        unreadableTool,
        {
          name: "loop",
          description: "Loop",
          parameters: cyclicSchema,
        },
        {
          name: "lookup",
          description: "Lookup",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
            },
          },
        },
      ] as never,
      "any",
    );

    expect(toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: "lookup",
            description: "Lookup",
            inputSchema: {
              json: {
                type: "object",
                properties: {
                  id: { type: "string" },
                },
              },
            },
          },
        },
      ],
      toolChoice: { any: {} },
    });
  });

  it("fails closed when a forced tool choice is skipped", () => {
    const cyclicSchema: Record<string, unknown> = { type: "object" };
    cyclicSchema.self = cyclicSchema;

    expect(() =>
      testing.convertToolConfig(
        [
          {
            name: "loop",
            description: "Loop",
            parameters: cyclicSchema,
          },
          {
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ] as never,
        { type: "tool", name: "loop" },
      ),
    ).toThrow('Bedrock toolChoice requires unavailable tool "loop"');
  });

  it("fails closed when a forced tool choice name is unreadable", () => {
    const unreadableToolChoice = { type: "tool" };
    Object.defineProperty(unreadableToolChoice, "name", {
      enumerable: true,
      get() {
        throw new Error("raw forced name getter");
      },
    });

    expect(() =>
      testing.convertToolConfig(
        [
          {
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ] as never,
        unreadableToolChoice as never,
      ),
    ).toThrow("Bedrock forced toolChoice name is unreadable");
  });

  it("fails closed when any-choice has no surviving tools", () => {
    const cyclicSchema: Record<string, unknown> = { type: "object" };
    cyclicSchema.self = cyclicSchema;

    expect(() =>
      testing.convertToolConfig(
        [
          {
            name: "loop",
            description: "Loop",
            parameters: cyclicSchema,
          },
        ] as never,
        "any",
      ),
    ).toThrow('Bedrock toolChoice "any" requires at least one available tool');
  });
});
