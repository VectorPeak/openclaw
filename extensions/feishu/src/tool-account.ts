// Feishu plugin module implements tool account behavior.
import type * as Lark from "@larksuiteoapi/node-sdk";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { getSessionBindingService } from "openclaw/plugin-sdk/session-binding-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { OpenClawPluginApi } from "../runtime-api.js";
import {
  listFeishuAccountIds,
  resolveFeishuAccount,
  resolveFeishuRuntimeAccount,
} from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { resolveToolsConfig } from "./tools-config.js";
import type { FeishuToolsConfig, ResolvedFeishuAccount } from "./types.js";

type AccountAwareParams = { accountId?: string };
type FeishuToolFamily = keyof FeishuToolsConfig;
type FeishuToolRequirement = {
  family: FeishuToolFamily;
  label: string;
};

function resolveImplicitToolAccountId(params: {
  api: Pick<OpenClawPluginApi, "config">;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
  sessionKey?: string;
  requiredTool?: FeishuToolRequirement;
}): string | undefined {
  const explicitAccountId = normalizeOptionalString(params.executeParams?.accountId);
  if (explicitAccountId) {
    return explicitAccountId;
  }

  const contextualAccountId = normalizeOptionalString(params.defaultAccountId);
  if (
    contextualAccountId &&
    listFeishuAccountIds(params.api.config).includes(contextualAccountId)
  ) {
    const contextualAccount = resolveFeishuAccount({
      cfg: params.api.config,
      accountId: contextualAccountId,
    });
    if (contextualAccount.enabled) {
      return contextualAccountId;
    }
  }

  const boundAccountId = resolveFeishuBoundToolAccountId({
    api: params.api,
    sessionKey: params.sessionKey,
  });
  if (boundAccountId) {
    return boundAccountId;
  }

  const configuredBoundAccountId = resolveFeishuConfiguredBoundToolAccountId({
    api: params.api,
    sessionKey: params.sessionKey,
  });
  if (configuredBoundAccountId) {
    return configuredBoundAccountId;
  }

  if (params.requiredTool && params.api.config) {
    for (const accountId of listFeishuAccountIds(params.api.config)) {
      const account = resolveFeishuAccount({ cfg: params.api.config, accountId });
      if (
        account.enabled &&
        account.configured &&
        resolveToolsConfig(account.config.tools)[params.requiredTool.family]
      ) {
        return accountId;
      }
    }
  }

  const configuredDefaultAccountId = normalizeOptionalString(
    (params.api.config?.channels?.feishu as { defaultAccount?: unknown } | undefined)
      ?.defaultAccount,
  );
  if (configuredDefaultAccountId) {
    return configuredDefaultAccountId;
  }

  return undefined;
}

function resolveFeishuBoundToolAccountId(params: {
  api: Pick<OpenClawPluginApi, "config">;
  sessionKey?: string;
}): string | undefined {
  const normalizedSessionKey = normalizeOptionalString(params.sessionKey);
  if (!normalizedSessionKey) {
    return undefined;
  }
  const accountIds = [
    ...new Set(
      getSessionBindingService()
        .listBySession(normalizedSessionKey)
        .filter((binding) => binding.conversation.channel === "feishu")
        .map((binding) => normalizeOptionalString(binding.conversation.accountId))
        .filter((accountId): accountId is string => Boolean(accountId)),
    ),
  ].filter((accountId) => {
    if (!listFeishuAccountIds(params.api.config).includes(accountId)) {
      return false;
    }
    return resolveFeishuAccount({ cfg: params.api.config, accountId }).enabled;
  });
  if (accountIds.length > 1) {
    throw new Error("Feishu tool account is ambiguous for the current session");
  }
  return accountIds[0];
}

function parseFeishuSessionRoute(rest: string): { peerId: string; peerKind: string } | undefined {
  const parts = rest.split(":");
  if (parts[0] !== "feishu" || parts.length < 3) {
    return undefined;
  }
  const peerKind = normalizeOptionalString(parts[1])?.toLowerCase();
  const peerId = normalizeOptionalString(parts.slice(2).join(":"));
  if (!peerKind || !peerId) {
    return undefined;
  }
  return { peerId, peerKind };
}
function resolveFeishuConfiguredBoundToolAccountId(params: {
  api: Pick<OpenClawPluginApi, "config">;
  sessionKey?: string;
}): string | undefined {
  if (!params.api.config) {
    return undefined;
  }
  const parsedSessionKey = parseAgentSessionKey(params.sessionKey);
  if (!parsedSessionKey) {
    return undefined;
  }
  const parsedRoute = parseFeishuSessionRoute(parsedSessionKey.rest);
  if (parsedRoute) {
    const routeAccountId = listConfiguredFeishuBindingAccountIds({
      api: params.api,
      agentId: parsedSessionKey.agentId,
      peerId: parsedRoute.peerId,
      peerKind: parsedRoute.peerKind,
    })[0];
    if (routeAccountId) {
      return listFeishuAccountIds(params.api.config).includes(routeAccountId) &&
        resolveFeishuAccount({ cfg: params.api.config, accountId: routeAccountId }).enabled
        ? routeAccountId
        : undefined;
    }
  }
  const accountIds = listConfiguredFeishuBindingAccountIds({
    api: params.api,
    agentId: parsedSessionKey.agentId,
  });
  if (accountIds.length > 1) {
    throw new Error("Feishu configured tool account is ambiguous for the current session");
  }
  const accountId = accountIds[0];
  if (!accountId || !listFeishuAccountIds(params.api.config).includes(accountId)) {
    return undefined;
  }
  return resolveFeishuAccount({ cfg: params.api.config, accountId }).enabled
    ? accountId
    : undefined;
}

function listConfiguredFeishuBindingAccountIds(params: {
  api: Pick<OpenClawPluginApi, "config">;
  agentId: string;
  peerId?: string;
  peerKind?: string;
}): string[] {
  const accountIds = new Set<string>();
  for (const binding of Array.isArray(params.api.config?.bindings)
    ? params.api.config.bindings
    : []) {
    const bindingAgentId = normalizeOptionalString(binding.agentId)?.toLowerCase();
    if (
      binding.type === "acp" ||
      !bindingAgentId ||
      bindingAgentId !== params.agentId.toLowerCase()
    ) {
      continue;
    }
    const match = binding.match;
    if (
      !match ||
      typeof match !== "object" ||
      normalizeOptionalString(match.channel)?.toLowerCase() !== "feishu"
    ) {
      continue;
    }
    if (params.peerId) {
      const peer = match.peer;
      if (
        !peer ||
        typeof peer !== "object" ||
        normalizeOptionalString(peer.id) !== params.peerId ||
        (params.peerKind &&
          normalizeOptionalString(peer.kind)?.toLowerCase() !== params.peerKind.toLowerCase())
      ) {
        continue;
      }
    }
    const accountId = normalizeOptionalString(match.accountId);
    if (accountId && accountId !== "*") {
      accountIds.add(accountId);
    }
  }
  return [...accountIds];
}

export function resolveFeishuToolAccount(params: {
  api: Pick<OpenClawPluginApi, "config">;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
  sessionKey?: string;
  requiredTool?: FeishuToolRequirement;
}): ResolvedFeishuAccount {
  if (!params.api.config) {
    throw new Error("Feishu config unavailable");
  }
  const account = resolveFeishuRuntimeAccount({
    cfg: params.api.config,
    accountId: resolveImplicitToolAccountId(params),
  });
  if (
    params.requiredTool &&
    !resolveToolsConfig(account.config.tools)[params.requiredTool.family]
  ) {
    throw new Error(
      `Feishu ${params.requiredTool.label} tools are disabled for account "${account.accountId}"`,
    );
  }
  return account;
}

export function createFeishuToolClient(params: {
  api: Pick<OpenClawPluginApi, "config">;
  executeParams?: AccountAwareParams;
  defaultAccountId?: string;
  sessionKey?: string;
  requiredTool?: FeishuToolRequirement;
}): Lark.Client {
  return createFeishuClient(resolveFeishuToolAccount(params));
}

export function resolveAnyEnabledFeishuToolsConfig(
  accounts: ResolvedFeishuAccount[],
): Required<FeishuToolsConfig> {
  const merged: Required<FeishuToolsConfig> = {
    doc: false,
    chat: false,
    wiki: false,
    drive: false,
    perm: false,
    scopes: false,
    bitable: false,
    base: false,
  };
  for (const account of accounts) {
    const cfg = resolveToolsConfig(account.config.tools);
    merged.doc = merged.doc || cfg.doc;
    merged.chat = merged.chat || cfg.chat;
    merged.wiki = merged.wiki || cfg.wiki;
    merged.drive = merged.drive || cfg.drive;
    merged.perm = merged.perm || cfg.perm;
    merged.scopes = merged.scopes || cfg.scopes;
    merged.bitable = merged.bitable || cfg.bitable;
    merged.base = merged.base || cfg.base;
  }
  return merged;
}
