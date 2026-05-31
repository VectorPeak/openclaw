import {
  expectExplicitMusicGenerationCapabilities,
  expectExplicitVideoGenerationCapabilities,
} from "openclaw/plugin-sdk/provider-test-contracts";
import { describe, it } from "vitest";
import { buildAlibabaVideoGenerationProvider } from "./alibaba/video-generation-provider.js";
import { buildBytePlusVideoGenerationProvider } from "./byteplus/video-generation-provider.js";
import { buildComfyMusicGenerationProvider } from "./comfy/music-generation-provider.js";
import { buildComfyVideoGenerationProvider } from "./comfy/video-generation-provider.js";
import { buildDeepInfraVideoGenerationProvider } from "./deepinfra/video-generation-provider.js";
import { buildFalMusicGenerationProvider } from "./fal/music-generation-provider.js";
import { buildFalVideoGenerationProvider } from "./fal/video-generation-provider.js";
import { buildGoogleMusicGenerationProvider } from "./google/music-generation-provider.js";
import { buildGoogleVideoGenerationProvider } from "./google/video-generation-provider.js";
import { buildMinimaxMusicGenerationProvider } from "./minimax/music-generation-provider.js";
import { buildMinimaxVideoGenerationProvider } from "./minimax/video-generation-provider.js";
import { buildOpenAIVideoGenerationProvider } from "./openai/video-generation-provider.js";
import { buildOpenRouterMusicGenerationProvider } from "./openrouter/music-generation-provider.js";
import { buildOpenRouterVideoGenerationProvider } from "./openrouter/video-generation-provider.js";
import { buildPixVerseVideoGenerationProvider } from "./pixverse/video-generation-provider.js";
import { buildQwenVideoGenerationProvider } from "./qwen/video-generation-provider.js";
import { buildRunwayVideoGenerationProvider } from "./runway/video-generation-provider.js";
import { buildTogetherVideoGenerationProvider } from "./together/video-generation-provider.js";
import { buildVydraVideoGenerationProvider } from "./vydra/video-generation-provider.js";
import { buildXaiVideoGenerationProvider } from "./xai/video-generation-provider.js";

type VideoProviderBuilder = () => Parameters<typeof expectExplicitVideoGenerationCapabilities>[0];
type MusicProviderBuilder = () => Parameters<typeof expectExplicitMusicGenerationCapabilities>[0];

const VIDEO_PROVIDER_CAPABILITY_CASES = [
  ["alibaba", buildAlibabaVideoGenerationProvider],
  ["byteplus", buildBytePlusVideoGenerationProvider],
  ["comfy", buildComfyVideoGenerationProvider],
  ["deepinfra", buildDeepInfraVideoGenerationProvider],
  ["fal", buildFalVideoGenerationProvider],
  ["google", buildGoogleVideoGenerationProvider],
  ["minimax", buildMinimaxVideoGenerationProvider],
  ["openai", buildOpenAIVideoGenerationProvider],
  ["openrouter", buildOpenRouterVideoGenerationProvider],
  ["pixverse", buildPixVerseVideoGenerationProvider],
  ["qwen", buildQwenVideoGenerationProvider],
  ["runway", buildRunwayVideoGenerationProvider],
  ["together", buildTogetherVideoGenerationProvider],
  ["vydra", buildVydraVideoGenerationProvider],
  ["xai", buildXaiVideoGenerationProvider],
] satisfies readonly [string, VideoProviderBuilder][];

const MUSIC_PROVIDER_CAPABILITY_CASES = [
  ["comfy", buildComfyMusicGenerationProvider],
  ["fal", buildFalMusicGenerationProvider],
  ["google", buildGoogleMusicGenerationProvider],
  ["minimax", buildMinimaxMusicGenerationProvider],
  ["openrouter", buildOpenRouterMusicGenerationProvider],
] satisfies readonly [string, MusicProviderBuilder][];

describe("bundled media-generation provider capability contracts", () => {
  it.each(VIDEO_PROVIDER_CAPABILITY_CASES)(
    "declares explicit video mode capabilities for %s",
    (_name, buildProvider) => {
      expectExplicitVideoGenerationCapabilities(buildProvider());
    },
  );

  it.each(MUSIC_PROVIDER_CAPABILITY_CASES)(
    "declares explicit music mode capabilities for %s",
    (_name, buildProvider) => {
      expectExplicitMusicGenerationCapabilities(buildProvider());
    },
  );
});
