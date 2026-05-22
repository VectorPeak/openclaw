import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const scriptPath = path.resolve("scripts/mantis/pr-desktop-lease.mjs");
const currentHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const staleHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "mantis-pr-desktop-lease-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, source: string) {
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}

function parseCalls(callsPath: string): Array<{ args: string[]; tool: string }> {
  return readFileSync(callsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; tool: string });
}

function runLeaseScript(
  payload: Record<string, string>,
  comments: Array<Record<string, unknown> | string> = [],
) {
  const dir = makeTempDir();
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir);
  const callsPath = path.join(dir, "calls.jsonl");
  const commentBodyPath = path.join(dir, "comment.md");
  const eventPath = path.join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify({ client_payload: payload }));
  writeFileSync(callsPath, "");

  writeExecutable(
    path.join(binDir, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS_PATH, JSON.stringify({ tool: "gh", args }) + "\\n");
const apiPath = args.find((arg) => arg.startsWith("repos/")) || "";
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({ state: "OPEN", headRefOid: process.env.PR_HEAD_SHA || "new-head" }));
  process.exit(0);
}
if (args[0] === "api" && apiPath.includes("/comments?")) {
  console.log(process.env.PR_COMMENTS || "[]");
  process.exit(0);
}
if (args[0] === "api" && apiPath.includes("/issues/comments/")) {
  const bodyArg = args.find((arg) => arg.startsWith("body=@"));
  fs.writeFileSync(process.env.COMMENT_BODY_PATH, bodyArg ? fs.readFileSync(bodyArg.slice(6), "utf8") : "");
  process.exit(0);
}
if (args[0] === "api" && apiPath.endsWith("/comments")) {
  const bodyArg = args.find((arg) => arg.startsWith("body=@"));
  fs.writeFileSync(process.env.COMMENT_BODY_PATH, bodyArg ? fs.readFileSync(bodyArg.slice(6), "utf8") : "");
  process.exit(0);
}
console.error("unexpected gh args", args.join(" "));
process.exit(2);
`,
  );

  writeExecutable(
    path.join(binDir, "crabbox"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS_PATH, JSON.stringify({ tool: "crabbox", args }) + "\\n");
if (args[0] === "inspect") {
  console.log(JSON.stringify({ status: "running" }));
  process.exit(0);
}
if (args[0] === "warmup") {
  console.log("lease ready cbx_test123");
  process.exit(0);
}
if (args[0] === "webvnc" && args[1] === "status") {
  console.log("https://crabbox.example.test/portal/leases/cbx_test123/vnc#password=redacted");
  process.exit(0);
}
process.exit(0);
`,
  );

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CALLS_PATH: callsPath,
      COMMENT_BODY_PATH: commentBodyPath,
      CRABBOX_COORDINATOR: "https://crabbox.example.test",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "openclaw/openclaw",
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      PR_COMMENTS: JSON.stringify(
        comments.map((comment, index) =>
          typeof comment === "string"
            ? { body: comment, id: index + 1, user: { login: "github-actions[bot]" } }
            : comment,
        ),
      ),
      PR_HEAD_SHA: currentHead,
    },
  });

  return {
    calls: parseCalls(callsPath),
    commentBody: result.status === 0 ? readFileSync(commentBodyPath, "utf8") : "",
    result,
  };
}

describe("scripts/mantis/pr-desktop-lease", () => {
  it("uses the active lease provider for stop even when the requested PR head is stale", () => {
    const activeComment = [
      "<!-- mantis-pr-desktop-lease:openclaw/openclaw:85136:linux -->",
      "- Platform: `linux`",
      "- Provider: `azure`",
      "- Lease: `cbx_active`",
      "- Expires: `2999-01-01T00:00:00.000Z`",
      "WebVNC: https://crabbox.example.test/portal/leases/cbx_active/vnc",
    ].join("\n");

    const { calls, commentBody, result } = runLeaseScript(
      {
        action: "stop",
        head_sha: staleHead,
        item_number: "85136",
        platform: "linux",
        provider: "aws",
        target_repo: "openclaw/openclaw",
      },
      [activeComment],
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(calls).toContainEqual({
      tool: "crabbox",
      args: ["inspect", "--provider", "azure", "--target", "linux", "--id", "cbx_active", "--json"],
    });
    expect(calls).toContainEqual({
      tool: "crabbox",
      args: ["stop", "--provider", "azure", "cbx_active"],
    });
    expect(commentBody).toContain("Stopped the Mantis Crabbox linux desktop lease");
    expect(commentBody).toContain("- Provider: `azure`");
  });

  it("does not create a new lease when a requested PR head is stale", () => {
    const { calls, commentBody, result } = runLeaseScript({
      action: "lease",
      head_sha: staleHead,
      item_number: "85136",
      platform: "mac",
      provider: "aws",
      target_repo: "openclaw/openclaw",
      ttl_minutes: "60",
    });

    expect(result.status).toBe(0);
    expect(calls.filter((call) => call.tool === "crabbox")).toEqual([]);
    expect(commentBody).toContain(`PR head changed from ${staleHead} to ${currentHead}`);
  });

  it("creates mac leases with AWS on-demand desktop semantics", () => {
    const { calls, commentBody, result } = runLeaseScript({
      action: "lease",
      head_sha: currentHead,
      item_number: "85136",
      platform: "mac",
      provider: "aws",
      target_repo: "openclaw/openclaw",
      ttl_minutes: "60",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(calls).toContainEqual({
      tool: "crabbox",
      args: [
        "warmup",
        "--provider",
        "aws",
        "--desktop",
        "--browser",
        "--ttl",
        "60m",
        "--idle-timeout",
        "30m",
        "--slug",
        "pr-85136-mac",
        "--target",
        "macos",
        "--market",
        "on-demand",
      ],
    });
    expect(commentBody).toContain("Mantis Crabbox desktop lease ready for PR testing.");
    expect(commentBody).toContain("- Platform: `mac`");
    expect(commentBody).toContain("- Provider: `aws`");
  });

  it("rejects provider and platform combinations that Crabbox cannot broker", () => {
    const { result } = runLeaseScript({
      action: "lease",
      item_number: "85136",
      platform: "mac",
      provider: "hetzner",
      target_repo: "openclaw/openclaw",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsupported provider/platform combination");
  });
});
