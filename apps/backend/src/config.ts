import path from "node:path";

import { z } from "zod";

export type NodeEnvironment = "development" | "test" | "production";
export type AuthMode = "single_user";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  logLevel: LogLevel;
  authMode: AuthMode;
  authPassword: string;
  sessionSecret: string;
  csrfSecret: string;
  cookieSecure: boolean;
  sessionTtlMinutes: number;
  allowedWorkspaceRoots: string[];
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  AUTH_MODE: z.enum(["single_user"]).default("single_user"),
  AUTH_PASSWORD: z.string().trim().min(12, "AUTH_PASSWORD must be at least 12 characters long"),
  SESSION_SECRET: z
    .string()
    .trim()
    .min(32, "SESSION_SECRET must be at least 32 characters long"),
  CSRF_SECRET: z
    .string()
    .trim()
    .min(32, "CSRF_SECRET must be at least 32 characters long"),
  COOKIE_SECURE: z.string().trim().optional(),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  ALLOWED_WORKSPACE_ROOTS: z.string().trim().min(1)
});

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function parseAllowedWorkspaceRoots(rawValue: string): string[] {
  const roots = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (roots.length === 0) {
    throw new ConfigValidationError(
      "Invalid configuration: ALLOWED_WORKSPACE_ROOTS must contain at least one path"
    );
  }

  for (const root of roots) {
    if (!path.isAbsolute(root)) {
      throw new ConfigValidationError(
        `Invalid configuration: ALLOWED_WORKSPACE_ROOTS contains non-absolute path '${root}'`
      );
    }
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function formatZodError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const key = issue.path.length > 0 ? issue.path.join(".") : "config";
      return `${key}: ${issue.message}`;
    })
    .join("; ");

  return `Invalid configuration: ${details}`;
}

function parseBooleanFlag(key: string, rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new ConfigValidationError(
    `Invalid configuration: ${key} must be a boolean-like value (true/false/1/0)`
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigValidationError(formatZodError(parsed.error));
  }

  const configData = parsed.data;
  const allowedWorkspaceRoots = parseAllowedWorkspaceRoots(configData.ALLOWED_WORKSPACE_ROOTS);
  const cookieSecure =
    configData.COOKIE_SECURE === undefined
      ? configData.NODE_ENV === "production"
      : parseBooleanFlag("COOKIE_SECURE", configData.COOKIE_SECURE);

  return {
    nodeEnv: configData.NODE_ENV,
    host: configData.HOST,
    port: configData.PORT,
    logLevel: configData.LOG_LEVEL,
    authMode: configData.AUTH_MODE,
    authPassword: configData.AUTH_PASSWORD,
    sessionSecret: configData.SESSION_SECRET,
    csrfSecret: configData.CSRF_SECRET,
    cookieSecure,
    sessionTtlMinutes: configData.SESSION_TTL_MINUTES,
    allowedWorkspaceRoots
  };
}

export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    ...config,
    authPassword: "[redacted]",
    sessionSecret: "[redacted]",
    csrfSecret: "[redacted]"
  };
}
