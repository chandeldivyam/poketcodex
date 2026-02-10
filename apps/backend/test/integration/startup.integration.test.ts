import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

function runBackendWithEnv(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const backendCwd = path.resolve(process.cwd());
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: backendCwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Backend process did not exit in time"));
    }, 8000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr });
    });
  });
}

describe("startup integration", () => {
  it("exits with a clear configuration error when env is invalid", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "8787",
      AUTH_MODE: "single_user",
      SESSION_SECRET: "",
      CSRF_SECRET: "csrf-secret-for-tests-123456789012",
      SESSION_TTL_MINUTES: "60",
      ALLOWED_WORKSPACE_ROOTS: "/tmp"
    };

    const result = await runBackendWithEnv(env);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid configuration");
    expect(result.stderr).toContain("SESSION_SECRET");
  });
});
