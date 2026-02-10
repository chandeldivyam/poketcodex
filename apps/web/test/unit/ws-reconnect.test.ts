import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReconnectingWorkspaceSocket } from "../../src/lib/ws-reconnect.js";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(): void {
    this.onerror?.({} as Event);
  }
}

interface GlobalWindowShape {
  window?: Window & typeof globalThis;
}

interface GlobalSocketShape {
  WebSocket?: typeof WebSocket;
}

const globalWindow = globalThis as unknown as GlobalWindowShape;
const globalSocket = globalThis as unknown as GlobalSocketShape;

const originalWindow = globalWindow.window;
const originalWebSocket = globalSocket.WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];

  let nextTimerId = 1;
  const timerHandles = new Map<number, unknown>();

  globalWindow.window = {
    location: {
      protocol: "http:",
      host: "127.0.0.1:5173"
    },
    setTimeout: ((handler: TimerHandler, timeout?: number) => {
      const callback =
        typeof handler === "function"
          ? handler
          : () => {
              // Timer strings are never used by this code path.
            };

      const timerId = nextTimerId;
      nextTimerId += 1;

      const handle = setTimeout(callback, timeout ?? 0);
      timerHandles.set(timerId, handle);
      return timerId;
    }) as Window["setTimeout"],
    clearTimeout: ((timerId: number) => {
      const handle = timerHandles.get(timerId);
      if (!handle) {
        return;
      }

      clearTimeout(handle as ReturnType<typeof setTimeout>);
      timerHandles.delete(timerId);
    }) as Window["clearTimeout"]
  } as unknown as Window & typeof globalThis;

  globalSocket.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();

  if (originalWindow === undefined) {
    delete globalWindow.window;
  } else {
    globalWindow.window = originalWindow;
  }

  if (originalWebSocket === undefined) {
    delete globalSocket.WebSocket;
  } else {
    globalSocket.WebSocket = originalWebSocket;
  }
});

describe("ReconnectingWorkspaceSocket", () => {
  it("connects and forwards websocket payloads", () => {
    const states: string[] = [];
    const messages: unknown[] = [];

    const socket = new ReconnectingWorkspaceSocket({
      workspaceId: "workspace-1",
      onStateChange: (state) => {
        states.push(state);
      },
      onMessage: (payload) => {
        messages.push(payload);
      }
    });

    socket.connect();

    const connection = FakeWebSocket.instances[0];
    if (!connection) {
      throw new Error("Expected websocket instance to be created");
    }

    expect(connection.url).toBe("ws://127.0.0.1:5173/api/workspaces/workspace-1/events");
    expect(states).toEqual(["connecting"]);

    connection.emitOpen();
    expect(states.at(-1)).toBe("connected");

    connection.emitMessage('{"ok":true}');
    connection.emitMessage("not-json");

    expect(messages).toEqual([
      {
        ok: true
      },
      {
        type: "parse_error",
        raw: "not-json"
      }
    ]);

    socket.disconnect();
    expect(connection.closeCalls).toBe(1);
    expect(states.at(-1)).toBe("disconnected");
  });

  it("reconnects automatically after an unexpected close", () => {
    const states: string[] = [];

    const socket = new ReconnectingWorkspaceSocket({
      workspaceId: "workspace-2",
      onStateChange: (state) => {
        states.push(state);
      },
      onMessage: () => {
        // Not used in this test.
      }
    });

    socket.connect();

    const firstConnection = FakeWebSocket.instances[0];
    if (!firstConnection) {
      throw new Error("Expected initial websocket instance");
    }

    firstConnection.emitOpen();
    firstConnection.emitClose();

    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(599);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(states.at(-1)).toBe("reconnecting");

    const secondConnection = FakeWebSocket.instances[1];
    if (!secondConnection) {
      throw new Error("Expected reconnect websocket instance");
    }

    secondConnection.emitOpen();
    expect(states.at(-1)).toBe("connected");

    socket.disconnect();
  });

  it("disconnects sockets that are still connecting", () => {
    const states: string[] = [];

    const socket = new ReconnectingWorkspaceSocket({
      workspaceId: "workspace-3",
      onStateChange: (state) => {
        states.push(state);
      },
      onMessage: () => {
        // Not used in this test.
      }
    });

    socket.connect();

    const connection = FakeWebSocket.instances[0];
    if (!connection) {
      throw new Error("Expected websocket instance");
    }

    expect(connection.readyState).toBe(FakeWebSocket.CONNECTING);

    socket.disconnect();

    expect(connection.closeCalls).toBe(1);
    expect(states.at(-1)).toBe("disconnected");

    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
