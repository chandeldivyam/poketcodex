import fs from "node:fs";
import path from "node:path";

export interface ValidatedWorkspacePath {
  canonicalPath: string;
  matchedRoot: string;
}

export class WorkspacePathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathValidationError";
  }
}

function canonicalizeRoot(rootPath: string): string {
  const absoluteRootPath = path.resolve(rootPath);
  try {
    return fs.realpathSync.native(absoluteRootPath);
  } catch {
    return absoluteRootPath;
  }
}

function isPathWithinRoot(candidatePath: string, allowedRoot: string): boolean {
  return candidatePath === allowedRoot || candidatePath.startsWith(`${allowedRoot}${path.sep}`);
}

export function validateWorkspacePath(
  workspacePath: string,
  allowedRoots: string[]
): ValidatedWorkspacePath {
  if (!path.isAbsolute(workspacePath)) {
    throw new WorkspacePathValidationError("Workspace path must be absolute");
  }

  if (allowedRoots.length === 0) {
    throw new WorkspacePathValidationError("No allowed workspace roots are configured");
  }

  const resolvedWorkspacePath = path.resolve(workspacePath);

  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync.native(resolvedWorkspacePath);
  } catch (error: unknown) {
    throw new WorkspacePathValidationError(
      error instanceof Error
        ? `Workspace path is not accessible: ${error.message}`
        : "Workspace path is not accessible"
    );
  }

  const stat = fs.statSync(canonicalPath);
  if (!stat.isDirectory()) {
    throw new WorkspacePathValidationError("Workspace path must point to a directory");
  }

  const canonicalRoots = allowedRoots.map((rootPath) => canonicalizeRoot(rootPath));
  const matchedRoot = canonicalRoots.find((rootPath) => isPathWithinRoot(canonicalPath, rootPath));

  if (!matchedRoot) {
    throw new WorkspacePathValidationError(
      "Workspace path is outside configured allowed roots or resolves via symlink escape"
    );
  }

  return {
    canonicalPath,
    matchedRoot
  };
}
