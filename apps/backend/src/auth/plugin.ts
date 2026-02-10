import cookie from "@fastify/cookie";
import fastifyPlugin from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config.js";
import { generateCsrfToken, secureEqual, validateCsrfToken } from "./csrf.js";
import { InMemorySessionStore, type SessionRecord } from "./session-store.js";

export const SESSION_COOKIE_NAME = "poketcodex_session";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

declare module "fastify" {
  interface FastifyRequest {
    authSession?: SessionRecord;
  }
}

export interface AuthPluginOptions {
  config: AppConfig;
  sessionStore?: InMemorySessionStore;
}

function readSessionFromCookie(
  request: FastifyRequest,
  sessionStore: InMemorySessionStore
): SessionRecord | null {
  const sessionCookie = request.cookies[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    return null;
  }

  const unsignedCookie = request.unsignCookie(sessionCookie);

  if (!unsignedCookie.valid) {
    return null;
  }

  return sessionStore.getSession(unsignedCookie.value);
}

function attachSessionCookie(reply: FastifyReply, config: AppConfig, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    signed: true,
    maxAge: config.sessionTtlMinutes * 60
  });
}

function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    signed: true
  });
}

const authPluginImplementation: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  const { config } = options;
  const sessionStore = options.sessionStore ?? new InMemorySessionStore();

  await app.register(cookie, { secret: config.sessionSecret });

  app.addHook("onRequest", async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) {
      return;
    }

    if (request.url.startsWith("/api/auth/login")) {
      return;
    }

    const session = readSessionFromCookie(request, sessionStore);

    if (!session) {
      reply.code(401).send({
        error: "unauthorized",
        message: "Authentication is required for mutating requests"
      });
      return;
    }

    const headerToken = request.headers["x-csrf-token"];
    const csrfToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (!csrfToken || !validateCsrfToken(csrfToken, session.id, config.csrfSecret)) {
      reply.code(403).send({
        error: "forbidden",
        message: "Missing or invalid CSRF token"
      });
      return;
    }

    request.authSession = session;
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { password?: unknown } | undefined;
    const password = body?.password;

    if (typeof password !== "string") {
      return reply.code(400).send({
        error: "bad_request",
        message: "password must be provided"
      });
    }

    if (!secureEqual(password, config.authPassword)) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Invalid credentials"
      });
    }

    const session = sessionStore.createSession(config.sessionTtlMinutes);
    const csrfToken = generateCsrfToken(session.id, config.csrfSecret);

    attachSessionCookie(reply, config, session.id);

    return reply.code(200).send({
      authenticated: true,
      csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (!request.authSession) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Session not found"
      });
    }

    sessionStore.deleteSession(request.authSession.id);
    clearSessionCookie(reply, config);

    return reply.code(200).send({
      authenticated: false
    });
  });

  app.get("/api/auth/session", async (request, reply) => {
    const session = readSessionFromCookie(request, sessionStore);

    if (!session) {
      clearSessionCookie(reply, config);
      return {
        authenticated: false
      };
    }

    return {
      authenticated: true,
      csrfToken: generateCsrfToken(session.id, config.csrfSecret),
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  });
};

export const authPlugin = fastifyPlugin(authPluginImplementation, {
  name: "poketcodex-auth-plugin"
});
