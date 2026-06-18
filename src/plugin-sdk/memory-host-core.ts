/**
 * Public SDK facade for memory host runtime core and public artifact discovery.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { MemoryPluginPublicArtifact } from "../plugins/memory-state.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { listAgentIds, resolveAgentWorkspaceDir } from "./memory-core-host-runtime-core.js";
import { resolveMemoryHostEventLogPath } from "./memory-host-events.js";

export * from "./memory-core-host-runtime-core.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function resolveArtifactAgentIds(
  relativePath: string,
  workspaceAgentIds: string[],
): string[] | null {
  const match = /^memory\/\.dreams\/agents\/([^/]+)\//.exec(relativePath);
  if (!match?.[1]) {
    if (relativePath.startsWith("memory/.dreams/")) {
      // Private artifacts without a recognized owner must not cross an agent boundary.
      return null;
    }
    return workspaceAgentIds;
  }
  return workspaceAgentIds.includes(match[1]) ? [match[1]] : null;
}

function resolveMemoryArtifactKind(
  relativePath: string,
): Extract<MemoryPluginPublicArtifact["kind"], "daily-note" | "dream-report"> {
  return relativePath.startsWith("memory/dreaming/") ||
    relativePath.startsWith("memory/.dreams/agents/")
    ? "dream-report"
    : "daily-note";
}

function resolveMemoryArtifactWorkspaces(cfg: OpenClawConfig): Array<{
  workspaceDir: string;
  agentIds: string[];
}> {
  const byWorkspace = new Map<string, { workspaceDir: string; agentIds: string[] }>();
  for (const rawAgentId of listAgentIds(cfg)) {
    const agentId = normalizeAgentId(rawAgentId);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const key = path.resolve(workspaceDir);
    const existing = byWorkspace.get(key);
    if (existing) {
      existing.agentIds.push(agentId);
      continue;
    }
    byWorkspace.set(key, { workspaceDir, agentIds: [agentId] });
  }
  return [...byWorkspace.values()];
}

/** Lists public memory artifacts for one workspace, including notes and event logs. */
export async function listMemoryWorkspacePublicArtifacts(params: {
  workspaceDir: string;
  agentIds: string[];
}): Promise<MemoryPluginPublicArtifact[]> {
  const artifacts: MemoryPluginPublicArtifact[] = [];
  const workspaceEntries = new Set(
    (await fs.readdir(params.workspaceDir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );

  if (workspaceEntries.has("MEMORY.md")) {
    const absolutePath = path.join(params.workspaceDir, "MEMORY.md");
    artifacts.push({
      kind: "memory-root",
      workspaceDir: params.workspaceDir,
      relativePath: "MEMORY.md",
      absolutePath,
      agentIds: [...params.agentIds],
      contentType: "markdown",
    });
  }

  const memoryDir = path.join(params.workspaceDir, "memory");
  for (const absolutePath of await listMarkdownFilesRecursive(memoryDir)) {
    const relativePath = path.relative(params.workspaceDir, absolutePath).replace(/\\/g, "/");
    const agentIds = resolveArtifactAgentIds(relativePath, params.agentIds);
    if (!agentIds) {
      continue;
    }
    artifacts.push({
      kind: resolveMemoryArtifactKind(relativePath),
      workspaceDir: params.workspaceDir,
      relativePath,
      absolutePath,
      agentIds,
      contentType: "markdown",
    });
  }

  for (const agentId of params.agentIds) {
    const eventLogPath = resolveMemoryHostEventLogPath(params.workspaceDir, agentId);
    if (!(await pathExists(eventLogPath))) {
      continue;
    }
    artifacts.push({
      kind: "event-log",
      workspaceDir: params.workspaceDir,
      relativePath: path.relative(params.workspaceDir, eventLogPath).replace(/\\/g, "/"),
      absolutePath: eventLogPath,
      agentIds: [agentId],
      contentType: "json",
    });
  }
  // The legacy journal has no owner. Do not expose it from a shared workspace:
  // it may contain recall queries from every agent that used that workspace.
  if (params.agentIds.length === 1) {
    const eventLogPath = resolveMemoryHostEventLogPath(params.workspaceDir);
    if (await pathExists(eventLogPath)) {
      artifacts.push({
        kind: "event-log",
        workspaceDir: params.workspaceDir,
        relativePath: path.relative(params.workspaceDir, eventLogPath).replace(/\\/g, "/"),
        absolutePath: eventLogPath,
        agentIds: [...params.agentIds],
        contentType: "json",
      });
    }
  }

  const deduped = new Map<string, MemoryPluginPublicArtifact>();
  for (const artifact of artifacts) {
    deduped.set(`${artifact.workspaceDir}\0${artifact.relativePath}\0${artifact.kind}`, artifact);
  }
  return [...deduped.values()];
}

/** Lists public memory artifacts across all configured memory workspaces. */
export async function listMemoryHostPublicArtifacts(params: {
  cfg: OpenClawConfig;
  agentId?: string;
}): Promise<MemoryPluginPublicArtifact[]> {
  const requestedAgentId = params.agentId ? normalizeAgentId(params.agentId) : undefined;
  const workspaces = resolveMemoryArtifactWorkspaces(params.cfg);
  const artifacts: MemoryPluginPublicArtifact[] = [];
  for (const workspace of workspaces) {
    artifacts.push(
      ...(await listMemoryWorkspacePublicArtifacts({
        workspaceDir: workspace.workspaceDir,
        agentIds: workspace.agentIds,
      })),
    );
  }
  return requestedAgentId
    ? artifacts.filter((artifact) => artifact.agentIds.includes(requestedAgentId))
    : artifacts;
}
