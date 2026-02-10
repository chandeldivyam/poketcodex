import type { LogLevel } from "./config.js";

export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-csrf-token",
  "req.headers.x-api-key",
  "res.headers.set-cookie",
  "config.sessionSecret",
  "config.csrfSecret"
] as const;

const REDACTABLE_FIELD_PATTERN = /secret|token|password|authorization|cookie/i;

export interface LoggerOptions {
  level: LogLevel;
  stream?: NodeJS.WritableStream;
}

export function createLoggerOptions(options: LoggerOptions) {
  const loggerOptions = {
    level: options.level,
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: "[redacted]"
    }
  };

  if (!options.stream) {
    return loggerOptions;
  }

  return {
    ...loggerOptions,
    stream: options.stream
  };
}

export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveFields(entry));
  }

  if (value !== null && typeof value === "object") {
    const redactedEntries = Object.entries(value).map(([key, entryValue]) => {
      if (REDACTABLE_FIELD_PATTERN.test(key)) {
        return [key, "[redacted]"];
      }

      return [key, redactSensitiveFields(entryValue)];
    });

    return Object.fromEntries(redactedEntries);
  }

  return value;
}
