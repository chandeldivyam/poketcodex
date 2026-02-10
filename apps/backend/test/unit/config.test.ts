import { describe, expect, it } from "vitest";

import { ConfigValidationError, loadConfig, redactConfig } from "../../src/config.js";

function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8787",
    AUTH_MODE: "single_user",
    SESSION_SECRET: "session-secret-for-tests-1234567890",
    CSRF_SECRET: "csrf-secret-for-tests-123456789012",
    SESSION_TTL_MINUTES: "60",
    ALLOWED_WORKSPACE_ROOTS: "/tmp,/var/tmp",
    ...overrides
  };
}

describe("loadConfig", () => {
  it.each(["0", "70000", "abc"])("rejects invalid PORT value %s", (portValue) => {
    expect(() => loadConfig(validEnv({ PORT: portValue }))).toThrow(ConfigValidationError);
  });

  it("rejects missing SESSION_SECRET", () => {
    const env = validEnv();
    delete env.SESSION_SECRET;

    expect(() => loadConfig(env)).toThrow(ConfigValidationError);
  });

  it("rejects non-absolute workspace roots", () => {
    expect(() =>
      loadConfig(
        validEnv({
          ALLOWED_WORKSPACE_ROOTS: "relative/path,/tmp"
        })
      )
    ).toThrow(ConfigValidationError);
  });

  it("redacts secrets in log-safe config", () => {
    const config = loadConfig(validEnv());
    const redacted = redactConfig(config);

    expect(redacted.sessionSecret).toBe("[redacted]");
    expect(redacted.csrfSecret).toBe("[redacted]");
  });
});
