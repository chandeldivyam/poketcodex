import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateWorkspacePath, WorkspacePathValidationError } from "../../src/workspaces/path-guard.js";

describe("validateWorkspacePath", () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    for (const target of cleanupTargets.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("accepts paths inside allowed roots and returns canonical path", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-path-guard-"));
    cleanupTargets.push(tempRoot);
    const allowedRoot = path.join(tempRoot, "allowed");
    const workspacePath = path.join(allowedRoot, "project-a");
    fs.mkdirSync(workspacePath, { recursive: true });

    const result = validateWorkspacePath(workspacePath, [allowedRoot]);

    expect(result.canonicalPath).toBe(fs.realpathSync.native(workspacePath));
    expect(result.matchedRoot).toBe(fs.realpathSync.native(allowedRoot));
  });

  it("rejects non-absolute paths", () => {
    expect(() => validateWorkspacePath("relative/path", ["/tmp"])).toThrow(WorkspacePathValidationError);
  });

  it("rejects symlink escapes outside allowed roots", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "poketcodex-path-guard-"));
    cleanupTargets.push(tempRoot);
    const allowedRoot = path.join(tempRoot, "allowed");
    const outsideRoot = path.join(tempRoot, "outside");
    const symlinkPath = path.join(allowedRoot, "escape-link");

    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, symlinkPath, "dir");

    expect(() => validateWorkspacePath(symlinkPath, [allowedRoot])).toThrow(WorkspacePathValidationError);
  });
});
