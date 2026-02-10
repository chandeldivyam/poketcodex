import path from "node:path";

import { z } from "zod";

export type NodeEnvironment = "development" | "test" | "production";
export type AuthMode = "single_user";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  authMode: AuthMode;
  sessionSecret: string;
  csrfSecret: string;
  sessionTtlMinutes: number;
  allowedWorkspaceRoots: string[];
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  AUTH_MODE: z.enum(["single_user"]).default("single_user"),
  SESSION_SECRET: z
    .string()
    .trim()
    .min(32, "SESSION_SECRET must be at least 32 characters long"),
  CSRF_SECRET: z
    .string()
    .trim()
    .min(32, "CSRF_SECRET must be at least 32 characters long"),
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigValidationError(formatZodError(parsed.error));
  }

  const configData = parsed.data;
  const allowedWorkspaceRoots = parseAllowedWorkspaceRoots(configData.ALLOWED_WORKSPACE_ROOTS);

  return {
    nodeEnv: configData.NODE_ENV,
    host: configData.HOST,
    port: configData.PORT,
    authMode: configData.AUTH_MODE,
    sessionSecret: configData.SESSION_SECRET,
    csrfSecret: configData.CSRF_SECRET,
    sessionTtlMinutes: configData.SESSION_TTL_MINUTES,
    allowedWorkspaceRoots
  };
}

export function redactConfig(config: AppConfig): Record<string, unknown> {
  return {
    ...config,
    sessionSecret: "[redacted]",
    csrfSecret: "[redacted]"
  };
}
