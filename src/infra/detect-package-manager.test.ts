import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { detectPackageManager } from "./detect-package-manager.js";

async function withPackageManagerRoot<T>(
  files: Array<{ path: string; content: string }>,
  run: (root: string) => Promise<T>,
): Promise<T> {
  return await withTempDir({ prefix: "openclaw-detect-pm-" }, async (root) => {
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
      await fs.writeFile(path.join(root, file.path), file.content, "utf8");
    }
    return await run(root);
  });
}

describe("detectPackageManager", () => {
  it("prefers packageManager from package.json when supported", async () => {
    await withPackageManagerRoot(
      [
        { path: "package.json", content: JSON.stringify({ packageManager: "pnpm@10.8.1" }) },
        { path: "package-lock.json", content: "" },
      ],
      async (root) => {
        await expect(detectPackageManager(root)).resolves.toBe("pnpm");
      },
    );
  });

  it("treats published npm package shrinkwrap as npm install evidence", async () => {
    await withPackageManagerRoot(
      [
        { path: "package.json", content: JSON.stringify({ packageManager: "pnpm@10.8.1" }) },
        { path: "npm-shrinkwrap.json", content: "" },
      ],
      async (root) => {
        await expect(detectPackageManager(root)).resolves.toBe("npm");
      },
    );
  });

  it("preserves pnpm-owned package roots that also carry shrinkwrap", async () => {
    await withTempDir({ prefix: "openclaw-detect-pm-pnpm-" }, async (base) => {
      const root = path.join(base, "5", "node_modules", "openclaw");
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.8.1" }),
        "utf8",
      );
      await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");
      await fs.writeFile(path.join(base, "5", "node_modules", ".modules.yaml"), "", "utf8");
      await fs.writeFile(path.join(base, "5", "pnpm-lock.yaml"), "", "utf8");

      await expect(detectPackageManager(root)).resolves.toBe("pnpm");
    });
  });

  it("preserves pnpm virtual-store package roots that also carry shrinkwrap", async () => {
    await withTempDir({ prefix: "openclaw-detect-pm-pnpm-store-" }, async (base) => {
      const root = path.join(
        base,
        "5",
        "node_modules",
        ".pnpm",
        "openclaw@1.0.0",
        "node_modules",
        "openclaw",
      );
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.8.1" }),
        "utf8",
      );
      await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");
      await fs.writeFile(path.join(base, "5", "node_modules", ".modules.yaml"), "", "utf8");
      await fs.writeFile(path.join(base, "5", "pnpm-lock.yaml"), "", "utf8");

      await expect(detectPackageManager(root)).resolves.toBe("pnpm");
    });
  });

  it("preserves project-local pnpm package roots that also carry shrinkwrap", async () => {
    await withTempDir({ prefix: "openclaw-detect-pm-local-pnpm-" }, async (base) => {
      const root = path.join(base, "node_modules", "openclaw");
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.8.1" }),
        "utf8",
      );
      await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");
      await fs.writeFile(path.join(base, "node_modules", ".modules.yaml"), "", "utf8");
      await fs.writeFile(path.join(base, "pnpm-lock.yaml"), "", "utf8");

      await expect(detectPackageManager(root)).resolves.toBe("pnpm");
    });
  });

  it("preserves project-local pnpm virtual-store roots that also carry shrinkwrap", async () => {
    await withTempDir({ prefix: "openclaw-detect-pm-local-pnpm-store-" }, async (base) => {
      const root = path.join(
        base,
        "node_modules",
        ".pnpm",
        "openclaw@1.0.0",
        "node_modules",
        "openclaw",
      );
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.8.1" }),
        "utf8",
      );
      await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");
      await fs.writeFile(path.join(base, "node_modules", ".modules.yaml"), "", "utf8");
      await fs.writeFile(path.join(base, "pnpm-lock.yaml"), "", "utf8");

      await expect(detectPackageManager(root)).resolves.toBe("pnpm");
    });
  });

  it("keeps packageManager precedence for pnpm source roots without git metadata", async () => {
    await withPackageManagerRoot(
      [
        { path: "package.json", content: JSON.stringify({ packageManager: "pnpm@10.8.1" }) },
        { path: "pnpm-lock.yaml", content: "" },
        { path: "npm-shrinkwrap.json", content: "" },
      ],
      async (root) => {
        await expect(detectPackageManager(root)).resolves.toBe("pnpm");
      },
    );
  });

  it("preserves bun-owned package roots that also carry shrinkwrap", async () => {
    const previousBunInstall = process.env.BUN_INSTALL;
    try {
      await withTempDir({ prefix: "openclaw-detect-pm-bun-" }, async (base) => {
        process.env.BUN_INSTALL = path.join(base, ".bun");
        const root = path.join(
          process.env.BUN_INSTALL,
          "install",
          "global",
          "node_modules",
          "openclaw",
        );
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ packageManager: "bun@1.2.0" }),
          "utf8",
        );
        await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");

        await expect(detectPackageManager(root)).resolves.toBe("bun");
      });
    } finally {
      if (previousBunInstall === undefined) {
        delete process.env.BUN_INSTALL;
      } else {
        process.env.BUN_INSTALL = previousBunInstall;
      }
    }
  });

  it("preserves bun-owned package roots with published pnpm metadata", async () => {
    const previousBunInstall = process.env.BUN_INSTALL;
    try {
      await withTempDir({ prefix: "openclaw-detect-pm-bun-published-" }, async (base) => {
        process.env.BUN_INSTALL = path.join(base, ".bun");
        const root = path.join(
          process.env.BUN_INSTALL,
          "install",
          "global",
          "node_modules",
          "openclaw",
        );
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ packageManager: "pnpm@10.8.1" }),
          "utf8",
        );
        await fs.writeFile(path.join(root, "npm-shrinkwrap.json"), "", "utf8");

        await expect(detectPackageManager(root)).resolves.toBe("bun");
      });
    } finally {
      if (previousBunInstall === undefined) {
        delete process.env.BUN_INSTALL;
      } else {
        process.env.BUN_INSTALL = previousBunInstall;
      }
    }
  });

  it("keeps packageManager precedence for git roots that also carry shrinkwrap", async () => {
    await withPackageManagerRoot(
      [
        { path: ".git", content: "" },
        { path: "package.json", content: JSON.stringify({ packageManager: "pnpm@10.8.1" }) },
        { path: "npm-shrinkwrap.json", content: "" },
      ],
      async (root) => {
        await expect(detectPackageManager(root)).resolves.toBe("pnpm");
      },
    );
  });

  it.each([
    {
      name: "uses bun.lock",
      files: [{ path: "bun.lock", content: "" }],
      expected: "bun",
    },
    {
      name: "uses bun.lockb",
      files: [{ path: "bun.lockb", content: "" }],
      expected: "bun",
    },
    {
      name: "falls back to npm lockfiles for unsupported packageManager values",
      files: [
        { path: "package.json", content: JSON.stringify({ packageManager: "yarn@4.0.0" }) },
        { path: "package-lock.json", content: "" },
      ],
      expected: "npm",
    },
    {
      name: "uses npm-shrinkwrap.json",
      files: [{ path: "npm-shrinkwrap.json", content: "" }],
      expected: "npm",
    },
  ])("falls back to lockfiles when $name", async ({ files, expected }) => {
    await withPackageManagerRoot(files, async (root) => {
      await expect(detectPackageManager(root)).resolves.toBe(expected);
    });
  });

  it("returns null when no package manager markers exist", async () => {
    await withPackageManagerRoot(
      [{ path: "package.json", content: "{not-json}" }],
      async (root) => {
        await expect(detectPackageManager(root)).resolves.toBeNull();
      },
    );
  });
});
