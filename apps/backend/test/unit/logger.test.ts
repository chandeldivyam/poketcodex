import { describe, expect, it } from "vitest";

import { createLoggerOptions, LOG_REDACT_PATHS, redactSensitiveFields } from "../../src/logger.js";

describe("createLoggerOptions", () => {
  it("includes standard redaction paths and log level", () => {
    const loggerOptions = createLoggerOptions({ level: "warn" });

    expect(loggerOptions.level).toBe("warn");
    expect(loggerOptions.redact.paths).toEqual([...LOG_REDACT_PATHS]);
    expect(loggerOptions.redact.censor).toBe("[redacted]");
  });
});

describe("redactSensitiveFields", () => {
  it("redacts nested sensitive keys", () => {
    const input = {
      sessionSecret: "abc",
      nested: {
        apiToken: "token-value",
        keep: "visible"
      }
    };

    expect(redactSensitiveFields(input)).toEqual({
      sessionSecret: "[redacted]",
      nested: {
        apiToken: "[redacted]",
        keep: "visible"
      }
    });
  });
});
