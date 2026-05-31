import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readPackageManagerSpec } from "./package-json.js";

type DetectedPackageManager = "pnpm" | "bun" | "npm";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function inferPnpmOwningNodeModulesFromPackageRoot(pkgRoot: string): string | null {
  const normalized = path.resolve(pkgRoot);
  const parts = normalized.split(path.sep);
  const pnpmIndex = parts.lastIndexOf(".pnpm");
  if (pnpmIndex > 0 && parts[pnpmIndex + 2] === "node_modules") {
    const owningNodeModules = parts.slice(0, pnpmIndex).join(path.sep) || path.sep;
    return path.basename(owningNodeModules) === "node_modules" ? owningNodeModules : null;
  }

  const directNodeModules = path.dirname(normalized);
  return path.basename(directNodeModules) === "node_modules" ? directNodeModules : null;
}

async function isPnpmOwnedPackageRoot(root: string): Promise<boolean> {
  const nodeModulesRoot = inferPnpmOwningNodeModulesFromPackageRoot(root);
  if (!nodeModulesRoot) {
    return false;
  }
  const projectOrLayoutRoot = path.dirname(nodeModulesRoot);
  const globalStoreRoot = /^\d+$/u.test(path.basename(projectOrLayoutRoot))
    ? path.dirname(projectOrLayoutRoot)
    : projectOrLayoutRoot;
  return (
    (await exists(path.join(nodeModulesRoot, ".modules.yaml"))) &&
    ((await exists(path.join(projectOrLayoutRoot, "pnpm-lock.yaml"))) ||
      (await exists(path.join(projectOrLayoutRoot, "package.json"))) ||
      (await exists(path.join(globalStoreRoot, "pnpm-lock.yaml"))) ||
      (await exists(path.join(globalStoreRoot, "package.json"))))
  );
}

function resolveBunGlobalRoot(): string {
  const bunInstall = process.env.BUN_INSTALL?.trim() || path.join(os.homedir(), ".bun");
  return path.join(bunInstall, "install", "global", "node_modules");
}

function isBunOwnedPackageRoot(root: string): boolean {
  return path.resolve(path.dirname(root)) === path.resolve(resolveBunGlobalRoot());
}

export async function detectPackageManager(root: string): Promise<DetectedPackageManager | null> {
  const files = await fs.readdir(root).catch((): string[] => []);
  const pm = (await readPackageManagerSpec(root))?.split("@")[0]?.trim();
  if (files.includes("npm-shrinkwrap.json") && !files.includes(".git")) {
    if (isBunOwnedPackageRoot(root)) {
      return "bun";
    }
    if (
      pm === "pnpm" &&
      (files.includes("pnpm-lock.yaml") || (await isPnpmOwnedPackageRoot(root)))
    ) {
      return "pnpm";
    }
    if (
      pm === "bun" &&
      (files.includes("bun.lock") || files.includes("bun.lockb") || isBunOwnedPackageRoot(root))
    ) {
      return "bun";
    }
    return "npm";
  }

  if (pm === "pnpm" || pm === "bun" || pm === "npm") {
    return pm;
  }

  if (files.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (files.includes("bun.lock") || files.includes("bun.lockb")) {
    return "bun";
  }
  if (files.includes("package-lock.json") || files.includes("npm-shrinkwrap.json")) {
    return "npm";
  }
  return null;
}
