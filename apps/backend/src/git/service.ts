import { spawn } from "node:child_process";
import path from "node:path";

import type { WorkspaceService } from "../workspaces/service.js";

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitStatusEntry {
  path: string;
  staged: string;
  unstaged: string;
  statusLabel: string;
  originalPath?: string;
}

export interface GitStatusSummary {
  enabled: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  entries: GitStatusEntry[];
}

export interface GitFileDiff {
  path: string;
  diff: string;
  isUntracked: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
}

export class GitServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitServiceError";
  }
}

export class GitWorkspaceNotFoundError extends GitServiceError {
  constructor(workspaceId: string) {
    super(`Workspace '${workspaceId}' was not found`);
    this.name = "GitWorkspaceNotFoundError";
  }
}

export class GitRepositoryUnavailableError extends GitServiceError {
  constructor(message: string) {
    super(message);
    this.name = "GitRepositoryUnavailableError";
  }
}

export class GitInvalidPathError extends GitServiceError {
  constructor(relativePath: string) {
    super(`Path '${relativePath}' is invalid for workspace git diff`);
    this.name = "GitInvalidPathError";
  }
}

export class GitCommandError extends GitServiceError {
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(`Git command failed (${command}) with exit code ${exitCode}`);
    this.name = "GitCommandError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.setEncoding("utf8");
    childProcess.stderr.setEncoding("utf8");
    childProcess.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    childProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    childProcess.on("error", (error: Error) => {
      reject(new GitServiceError(`Failed to start git command: ${error.message}`));
    });

    childProcess.on("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

function mapStatusLabel(staged: string, unstaged: string): string {
  const token = `${staged}${unstaged}`;
  if (token === "??") {
    return "Untracked";
  }

  if (token === "!!") {
    return "Ignored";
  }

  if (staged === "R" || unstaged === "R") {
    return "Renamed";
  }

  if (staged === "C" || unstaged === "C") {
    return "Copied";
  }

  if (staged === "A" || unstaged === "A") {
    return "Added";
  }

  if (staged === "D" || unstaged === "D") {
    return "Deleted";
  }

  if (staged === "U" || unstaged === "U") {
    return "Conflicted";
  }

  if (staged === "M" || unstaged === "M") {
    return "Modified";
  }

  return "Changed";
}

function parseBranchHeader(line: string): {
  branch: string | null;
  ahead: number;
  behind: number;
} {
  if (!line.startsWith("## ")) {
    return {
      branch: null,
      ahead: 0,
      behind: 0
    };
  }

  const payload = line.slice(3).trim();
  let branchPayload = payload;
  let ahead = 0;
  let behind = 0;

  const statusMatch = payload.match(/\[(.+)\]$/);
  if (statusMatch) {
    branchPayload = payload.slice(0, statusMatch.index).trim();
    const tokens = statusMatch[1]?.split(",") ?? [];
    for (const token of tokens) {
      const normalized = token.trim().toLowerCase();
      const aheadMatch = normalized.match(/^ahead\s+(\d+)$/);
      if (aheadMatch && aheadMatch[1]) {
        ahead = Number.parseInt(aheadMatch[1], 10);
      }

      const behindMatch = normalized.match(/^behind\s+(\d+)$/);
      if (behindMatch && behindMatch[1]) {
        behind = Number.parseInt(behindMatch[1], 10);
      }
    }
  }

  const branch = branchPayload.split("...")[0] ?? "";
  const normalizedBranch = branch.trim();

  return {
    branch: normalizedBranch.length > 0 && normalizedBranch !== "HEAD" ? normalizedBranch : null,
    ahead,
    behind
  };
}

function parseStatusEntries(lines: string[]): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];

  for (const rawLine of lines) {
    if (rawLine.startsWith("## ") || rawLine.length < 3) {
      continue;
    }

    const staged = rawLine[0] ?? " ";
    const unstaged = rawLine[1] ?? " ";
    const payload = rawLine.slice(3).trim();
    if (!payload) {
      continue;
    }

    const renameSplit = payload.split(" -> ");
    if (renameSplit.length === 2 && renameSplit[0] && renameSplit[1]) {
      entries.push({
        path: renameSplit[1],
        originalPath: renameSplit[0],
        staged,
        unstaged,
        statusLabel: mapStatusLabel(staged, unstaged)
      });
      continue;
    }

    entries.push({
      path: payload,
      staged,
      unstaged,
      statusLabel: mapStatusLabel(staged, unstaged)
    });
  }

  return entries.filter((entry) => entry.statusLabel !== "Ignored");
}

function normalizeRelativePath(workspaceRoot: string, inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    throw new GitInvalidPathError(inputPath);
  }

  if (path.isAbsolute(trimmed)) {
    throw new GitInvalidPathError(inputPath);
  }

  const normalizedRelative = path.normalize(trimmed);
  if (
    normalizedRelative === ".." ||
    normalizedRelative.startsWith(`..${path.sep}`) ||
    normalizedRelative.includes(`${path.sep}..${path.sep}`)
  ) {
    throw new GitInvalidPathError(inputPath);
  }

  const resolvedAbsolute = path.resolve(workspaceRoot, normalizedRelative);
  const rootWithSeparator = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
  if (resolvedAbsolute !== workspaceRoot && !resolvedAbsolute.startsWith(rootWithSeparator)) {
    throw new GitInvalidPathError(inputPath);
  }

  return normalizedRelative;
}

export class GitService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async getStatus(workspaceId: string): Promise<GitStatusSummary> {
    const workspace = this.workspaceService.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new GitWorkspaceNotFoundError(workspaceId);
    }

    const workspacePath = workspace.absolutePath;
    const repoCheck = await runGitCommand(workspacePath, ["rev-parse", "--is-inside-work-tree"]);
    if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim().toLowerCase() !== "true") {
      return {
        enabled: false,
        branch: null,
        ahead: 0,
        behind: 0,
        clean: true,
        entries: []
      };
    }

    const statusOutput = await runGitCommand(workspacePath, [
      "status",
      "--porcelain=1",
      "--branch",
      "--untracked-files=all"
    ]);
    if (statusOutput.exitCode !== 0) {
      throw new GitCommandError("git status --porcelain=1 --branch --untracked-files=all", statusOutput.exitCode, statusOutput.stderr);
    }

    const lines = statusOutput.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    const branchHeader = lines.find((line) => line.startsWith("## ")) ?? "";
    const branchData = parseBranchHeader(branchHeader);
    const entries = parseStatusEntries(lines);

    return {
      enabled: true,
      branch: branchData.branch,
      ahead: branchData.ahead,
      behind: branchData.behind,
      clean: entries.length === 0,
      entries
    };
  }

  async getFileDiff(workspaceId: string, relativePath: string): Promise<GitFileDiff> {
    const workspace = this.workspaceService.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new GitWorkspaceNotFoundError(workspaceId);
    }

    const workspacePath = workspace.absolutePath;
    const normalizedPath = normalizeRelativePath(workspacePath, relativePath);
    const status = await this.getStatus(workspaceId);
    if (!status.enabled) {
      throw new GitRepositoryUnavailableError("Git repository is not available for the selected workspace");
    }

    const entry = status.entries.find((candidate) => candidate.path === normalizedPath);
    const isUntracked = entry?.staged === "?" && entry?.unstaged === "?";

    if (isUntracked) {
      const diffOutput = await runGitCommand(workspacePath, [
        "diff",
        "--no-index",
        "--no-color",
        "--",
        "/dev/null",
        normalizedPath
      ]);

      if (diffOutput.exitCode !== 0 && diffOutput.exitCode !== 1) {
        throw new GitCommandError(`git diff --no-index -- /dev/null ${normalizedPath}`, diffOutput.exitCode, diffOutput.stderr);
      }

      return {
        path: normalizedPath,
        diff: diffOutput.stdout,
        isUntracked: true,
        hasStagedChanges: false,
        hasUnstagedChanges: true
      };
    }

    const stagedDiff = await runGitCommand(workspacePath, [
      "diff",
      "--cached",
      "--no-color",
      "--",
      normalizedPath
    ]);
    if (stagedDiff.exitCode !== 0 && stagedDiff.exitCode !== 1) {
      throw new GitCommandError(`git diff --cached ${normalizedPath}`, stagedDiff.exitCode, stagedDiff.stderr);
    }

    const unstagedDiff = await runGitCommand(workspacePath, [
      "diff",
      "--no-color",
      "--",
      normalizedPath
    ]);
    if (unstagedDiff.exitCode !== 0 && unstagedDiff.exitCode !== 1) {
      throw new GitCommandError(`git diff ${normalizedPath}`, unstagedDiff.exitCode, unstagedDiff.stderr);
    }

    const sections: string[] = [];
    const hasStagedChanges = stagedDiff.stdout.trim().length > 0;
    const hasUnstagedChanges = unstagedDiff.stdout.trim().length > 0;

    if (hasStagedChanges) {
      sections.push(stagedDiff.stdout.trimEnd());
    }

    if (hasUnstagedChanges) {
      sections.push(unstagedDiff.stdout.trimEnd());
    }

    return {
      path: normalizedPath,
      diff: sections.join("\n\n"),
      isUntracked: false,
      hasStagedChanges,
      hasUnstagedChanges
    };
  }
}
