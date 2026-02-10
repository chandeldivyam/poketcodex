import { createInterface } from "node:readline";

interface RpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

let isInitialized = false;

function sendMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id: number | string, code: number, message: string, data?: unknown): void {
  sendMessage({
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  });
}

function requireInitialized(request: RpcRequest): boolean {
  if (isInitialized) {
    return true;
  }

  sendError(request.id, -32002, "Not initialized");
  return false;
}

function handleRequest(request: RpcRequest): void {
  switch (request.method) {
    case "initialize":
      sendMessage({
        id: request.id,
        result: {
          serverInfo: {
            name: "fake-codex-app-server",
            version: "1.0.0"
          },
          capabilities: {
            approvals: true
          }
        }
      });
      return;
    case "test/no-response":
      return;
    case "test/delayed-response": {
      const delayMs = Number.parseInt(process.env.FAKE_DELAY_MS ?? "150", 10);
      setTimeout(() => {
        sendMessage({
          id: request.id,
          result: {
            ok: true,
            delayed: true
          }
        });
      }, delayMs);
      return;
    }
    case "test/duplicate-response":
      if (!requireInitialized(request)) {
        return;
      }
      sendMessage({
        id: request.id,
        result: {
          ok: true
        }
      });
      setTimeout(() => {
        sendMessage({
          id: request.id,
          result: {
            ok: true,
            duplicate: true
          }
        });
      }, 10);
      return;
    case "test/emit-events":
      if (!requireInitialized(request)) {
        return;
      }
      sendMessage({
        method: "thread/updated",
        params: {
          threadId: "thread-1"
        }
      });
      sendMessage({
        id: "approval-1",
        method: "approval/request",
        params: {
          kind: "command",
          command: "echo hello"
        }
      });
      sendMessage({
        id: request.id,
        result: {
          ok: true
        }
      });
      return;
    case "thread/list":
      if (!requireInitialized(request)) {
        return;
      }
      sendMessage({
        id: request.id,
        result: {
          threads: [
            {
              id: "thread-1"
            }
          ]
        }
      });
      return;
    case "shutdown":
      sendMessage({
        id: request.id,
        result: {
          ok: true
        }
      });
      setTimeout(() => {
        process.exit(0);
      }, 5);
      return;
    default:
      if (!requireInitialized(request)) {
        return;
      }
      sendError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

function handleNotification(method: string): void {
  if (method === "initialized") {
    isInitialized = true;
    if (process.env.FAKE_SERVER_NOTIFICATION_AFTER_INIT === "1") {
      sendMessage({
        method: "server/ready",
        params: {
          ok: true
        }
      });
    }
  }
}

const lineReader = createInterface({
  input: process.stdin
});

lineReader.on("line", (line) => {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) {
    return;
  }

  let message: unknown;
  try {
    message = JSON.parse(trimmedLine);
  } catch {
    return;
  }

  if (!message || typeof message !== "object") {
    return;
  }

  if ("id" in message && "method" in message && typeof message.method === "string") {
    handleRequest(message as RpcRequest);
    return;
  }

  if ("method" in message && typeof message.method === "string") {
    handleNotification(message.method);
  }
});
