// Slack plugin module implements client options behavior.
import type { Agent } from "node:http";
import type { RetryOptions, WebClientOptions } from "@slack/web-api";
import { createNodeProxyAgent } from "openclaw/plugin-sdk/fetch-runtime";

export type SlackApiUrlClientOptions = Pick<WebClientOptions, "slackApiUrl">;

export const SLACK_DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 2,
  factor: 2,
  minTimeout: 500,
  maxTimeout: 3000,
  randomize: true,
};

export const SLACK_WRITE_RETRY_OPTIONS: RetryOptions = {
  retries: 0,
};

/**
 * Build an HTTPS proxy agent from env vars (HTTPS_PROXY, HTTP_PROXY, etc.)
 * for use as the `agent` option in Slack WebClient and Socket Mode connections.
 *
 * When set, this agent is forwarded through @slack/bolt -> @slack/socket-mode ->
 * SlackWebSocket as the `httpAgent`, which the `ws` library uses to tunnel the
 * WebSocket upgrade request through the proxy. This fixes Socket Mode in
 * environments where outbound traffic must go through an HTTP CONNECT proxy.
 *
 * Respects `NO_PROXY` / `no_proxy`; if `*.slack.com` (or a matching pattern)
 * appears in the exclusion list, returns `undefined` so the connection is direct.
 *
 * Returns `undefined` when no proxy env var is configured or when Slack hosts
 * are excluded by `NO_PROXY`.
 */
function resolveSlackProxyAgent(targetUrl: string): Agent | undefined {
  try {
    return createNodeProxyAgent({
      mode: "env",
      targetUrl,
    });
  } catch {
    // Malformed proxy URL; degrade gracefully to direct connection.
    return undefined;
  }
}

function resolveSlackApiUrlFromOptions(
  options: Pick<WebClientOptions, "slackApiUrl">,
): string | undefined {
  const explicit = options.slackApiUrl?.trim();
  const envDefault = process.env.SLACK_API_URL?.trim();
  return explicit || envDefault || undefined;
}

export function createSlackApiUrlClientOptions(): SlackApiUrlClientOptions {
  const slackApiUrl = process.env.SLACK_API_URL?.trim();
  return slackApiUrl ? { slackApiUrl } : {};
}

export function resolveSlackWebClientOptions(options: WebClientOptions = {}): WebClientOptions {
  const slackApiUrl = resolveSlackApiUrlFromOptions(options);
  const proxyTargetUrl = slackApiUrl ?? "https://slack.com/";
  return {
    ...options,
    agent: options.agent ?? resolveSlackProxyAgent(proxyTargetUrl),
    retryConfig: options.retryConfig ?? SLACK_DEFAULT_RETRY_OPTIONS,
    ...(slackApiUrl ? { slackApiUrl } : {}),
  };
}

export function resolveSlackWriteClientOptions(options: WebClientOptions = {}): WebClientOptions {
  const slackApiUrl = resolveSlackApiUrlFromOptions(options);
  const proxyTargetUrl = slackApiUrl ?? "https://slack.com/";
  return {
    ...options,
    agent: options.agent ?? resolveSlackProxyAgent(proxyTargetUrl),
    retryConfig: options.retryConfig ?? SLACK_WRITE_RETRY_OPTIONS,
    maxRequestConcurrency: options.maxRequestConcurrency ?? 1,
    ...(slackApiUrl ? { slackApiUrl } : {}),
  };
}
