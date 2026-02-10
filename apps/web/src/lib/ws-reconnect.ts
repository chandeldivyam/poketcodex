export type SocketConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ReconnectingWorkspaceSocketOptions {
  workspaceId: string;
  onMessage(payload: unknown): void;
  onStateChange(state: SocketConnectionState): void;
}

const WS_OPEN_STATE = 1;
const WS_CONNECTING_STATE = 0;
const WS_CLOSING_STATE = 2;

function buildWorkspaceEventsUrl(workspaceId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/workspaces/${workspaceId}/events`;
}

export class ReconnectingWorkspaceSocket {
  private readonly options: ReconnectingWorkspaceSocketOptions;
  private socket: WebSocket | undefined;
  private reconnectTimer: number | undefined;
  private reconnectAttempts = 0;
  private closedByUser = false;

  constructor(options: ReconnectingWorkspaceSocketOptions) {
    this.options = options;
  }

  connect(): void {
    this.closedByUser = false;
    this.reconnectAttempts = 0;

    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (
      this.socket &&
      (this.socket.readyState === WS_CONNECTING_STATE || this.socket.readyState === WS_OPEN_STATE)
    ) {
      return;
    }

    this.openSocket();
  }

  disconnect(): void {
    this.closedByUser = true;

    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.socket && this.socket.readyState < WS_CLOSING_STATE) {
      this.socket.close(1000, "Client disconnect");
    }

    this.socket = undefined;
    this.options.onStateChange("disconnected");
  }

  private openSocket(): void {
    if (this.closedByUser) {
      return;
    }

    const state = this.reconnectAttempts > 0 ? "reconnecting" : "connecting";
    this.options.onStateChange(state);

    const websocket = new WebSocket(buildWorkspaceEventsUrl(this.options.workspaceId));
    this.socket = websocket;

    websocket.onopen = () => {
      if (this.closedByUser || this.socket !== websocket) {
        return;
      }

      this.reconnectAttempts = 0;
      this.options.onStateChange("connected");
    };

    websocket.onmessage = (event) => {
      if (this.closedByUser || this.socket !== websocket) {
        return;
      }

      const rawData = typeof event.data === "string" ? event.data : String(event.data);

      try {
        const parsed = JSON.parse(rawData) as unknown;
        this.options.onMessage(parsed);
      } catch {
        this.options.onMessage({
          type: "parse_error",
          raw: rawData
        });
      }
    };

    websocket.onclose = () => {
      if (this.socket === websocket) {
        this.socket = undefined;
      }

      if (this.reconnectTimer !== undefined) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }

      if (this.closedByUser) {
        return;
      }

      this.reconnectAttempts += 1;
      const delayMs = Math.min(4_000, 300 * 2 ** this.reconnectAttempts);
      this.reconnectTimer = window.setTimeout(() => {
        this.openSocket();
      }, delayMs);
    };

    websocket.onerror = () => {
      if (!this.closedByUser && this.socket === websocket && websocket.readyState !== WS_OPEN_STATE) {
        this.options.onStateChange("reconnecting");
      }
    };
  }
}
