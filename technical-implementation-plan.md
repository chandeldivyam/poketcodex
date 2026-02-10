# Technical Implementation Plan
## Mobile Codex Web App on Windows + WSL + Tailscale

- Date: February 10, 2026
- Status: Draft v1 (architecture-focused)
- Objective: Build a robust, mobile-friendly web application that runs on your local Windows/WSL machine, gives remote phone access over Tailscale, supports terminal access, workspace switching, and Codex thread/session workflows.

## 1. Executive Summary
Build a new web gateway around **`codex app-server` (v2 JSON-RPC)** instead of extending legacy `codex proto` wrappers. Keep Codex integration local and private, expose only a secure mobile UI over Tailscale, and design for reliable multi-workspace use with resumable sessions and auditable approvals.

This plan recommends:

1. `codex app-server` over **stdio** as the backend protocol (not app-server websocket mode).
2. A dedicated backend service in WSL that manages app-server processes, terminal sessions, and workspace state.
3. A mobile-first PWA frontend connected via WebSocket/SSE to stream turns/items/deltas.
4. Tailnet-only remote access via Tailscale Serve, with layered auth and strict workspace boundaries.
5. A phased rollout with hardening gates before daily-use rollout.

## 2. Scope
### In scope
- Mobile web UI to chat with Codex from phone.
- Open/select multiple project folders.
- Create/resume/archive threads.
- Stream Codex output in real time.
- Handle approval requests (command/file change/tool input) from phone.
- Remote terminal access from phone.
- Local-first deployment on your Windows + Ubuntu WSL machine.

### Out of scope (v1)
- Multi-tenant team platform.
- Public internet exposure (outside tailnet).
- Marketplace/social features.
- Fully managed cloud deployment.

## 3. Research Findings (from requested references)
### 3.1 `harryneopotter/Codex-webui`
Observed locally in your workspace (`Codex-webui`):
- Single Node server (`server.js`) + single-page HTML client.
- Uses `codex proto` child process and SSE streaming.
- Supports sessions, memory file management, basic config UI, restart/resume.
- Security is minimal by design (optional bearer token; localhost defaults).
- Good rapid prototype patterns, but limited process isolation and protocol stability for long-term architecture.

Useful to reuse:
- Simple SSE event fanout pattern.
- Lightweight session browser and resume UX.
- Local-first operational model.

Limitations to avoid in new build:
- Direct dependence on proto stream parsing.
- Single process model with coarse isolation.
- Sparse test surface and production hardening.

### 3.2 `milisp.dev` + `milisp/codexia`
From the site and cloned `codexia` repo:
- Codexia is a Tauri desktop app with a sophisticated remote-control mode.
- Uses app-server protocol patterns (v1 and v2 paths in repo) and per-workspace session/process handling.
- Includes a remote UI bridge (websocket transport between browser runtime and native command layer).
- Demonstrates advanced UX and process orchestration, but is desktop-app-first and coupled to Tauri runtime decisions.

Useful to reuse:
- Per-workspace process/session concept.
- Remote runtime bridge design ideas.
- Approval/event handling breadth.

Limitations for your use-case:
- Tauri-native assumptions add complexity for a pure WSL-hosted web app.
- Larger stack and wider dependency surface than needed for v1.

### 3.3 OpenAI Codex App Server docs + `openai/codex` source
Verified against official docs and cloned source (`codex-rs/app-server`, `codex-rs/app-server-protocol`):
- `codex app-server` uses JSON-RPC with omitted `jsonrpc` field on wire.
- **Transport defaults to stdio** (`stdio://`), websocket transport exists but is explicitly marked experimental/unsupported in docs.
- Strict initialization contract: `initialize` then `initialized`; early requests fail with "Not initialized"; repeated initialization fails with "Already initialized".
- v2 primitives are thread/turn/item with rich event stream and server-initiated approval requests.
- Approval and auth flows are first-class protocol features.
- Experimental surfaces are opt-in via `capabilities.experimentalApi`.
- `chatgptAuthTokens` auth flow is marked unstable/internal in protocol source and should not be relied on for this project.

Critical architecture implication:
- Build your own web-facing transport on top of **local stdio app-server sessions** rather than relying on app-server websocket mode.

## 4. Target Architecture

```text
Phone Browser (PWA)
  -> HTTPS/WSS via Tailscale (tailnet-only)
  -> Windows Tailscale Serve (reverse proxy)
  -> WSL Backend Service (Gateway API)
      -> Workspace Manager
      -> Codex App-Server Manager (stdio JSON-RPC)
      -> Terminal Manager (pty/tmux bridge)
      -> Session/Metadata Store (SQLite)
      -> Event Bus (WS/SSE fanout)
  -> codex app-server subprocess(es)
      -> local filesystem + ~/.codex/sessions
```

### 4.1 Why this architecture
- Aligns with official Codex API contract and upgrade path.
- Keeps Codex execution local in WSL, minimal network surface.
- Supports mobile streaming and approval UX cleanly.
- Enables future expansion (multiple workspaces, optional multi-user).

## 5. Core Design Decisions (ADR-style)

### ADR-01: Protocol choice
- Decision: Use `codex app-server` v2 over stdio.
- Rationale: Officially documented, strongly typed schema generation, approval/auth/event model built in.
- Rejected: Direct `codex proto` stream parsing for core architecture.

### ADR-02: Process isolation model
- Decision: One app-server process per active workspace (lazy start, LRU shutdown).
- Rationale: Better fault isolation, predictable cwd/sandbox boundaries, easier recovery.
- Rejected: Single shared app-server for all workspaces.

### ADR-03: Web transport
- Decision: Backend exposes WebSocket for realtime events + REST for commands/admin endpoints.
- Rationale: WS handles bidirectional approval/user-input requests better; REST keeps command actions explicit.
- Rejected: SSE-only for everything (awkward for server->client request/response loops).

### ADR-04: Terminal strategy
- Decision: Use `tmux`-backed terminal sessions via PTY bridge.
- Rationale: Survives browser disconnects; supports reattach from phone.
- Rejected: Ephemeral PTY per browser tab.

### ADR-05: Network exposure
- Decision: Tailnet-only access with Tailscale Serve; no Funnel/public exposure.
- Rationale: Least exposure for a tool that can run shell and edit files.
- Rejected: Open LAN/public bind from WSL service.

## 6. Component Design

### 6.1 Backend service (WSL)
Recommended stack:
- Runtime: Node.js 20+ with TypeScript.
- HTTP framework: Fastify (or Express if you want minimal friction).
- Realtime: native WebSocket server.
- Storage: SQLite (better-sqlite3 or Prisma/SQLite).

Responsibilities:
- API auth/session handling.
- Workspace registration and validation.
- App-server process lifecycle management.
- JSON-RPC correlation (request id mapping, timeout, retries).
- Event normalization for UI.
- Terminal session orchestration.
- Audit/event logging.

### 6.2 App-server manager
Per workspace:
- Spawn command: `codex app-server --listen stdio://`.
- Perform one-time initialize handshake:
  - send `initialize` with `clientInfo`.
  - send `initialized` notification.
- Maintain request map `{id -> promise}`.
- Parse server notifications and server requests.
- Route approval requests to active UI client.
- Auto-restart policy:
  - backoff with jitter.
  - preserve workspace/thread metadata.

Lifecycle states:
- `stopped`
- `starting`
- `ready`
- `degraded`
- `restarting`

### 6.3 Workspace manager
Data model fields:
- `workspace_id`
- `absolute_path`
- `display_name`
- `trusted` (bool)
- `created_at`, `updated_at`

Validation:
- Canonicalize path.
- Enforce allowlist root(s) (e.g., `/mnt/d/projects`, `/home/<user>/code`).
- Reject symlink escapes outside allowed roots.

### 6.4 Thread/turn orchestration
Core operations to wrap:
- `thread/start`, `thread/resume`, `thread/list`, `thread/archive`, `thread/read`.
- `turn/start`, `turn/steer`, `turn/interrupt`.
- `review/start`.

Event handling:
- Emit normalized frontend events for:
  - `turn/started`, `turn/completed`
  - `item/started`, `item/completed`
  - delta events (`agentMessage`, command output, reasoning)
  - approval requests
  - errors

### 6.5 Terminal manager
Preferred implementation:
- Create named tmux sessions per workspace/user context.
- WebSocket stream for stdin/stdout forwarding.
- Attach/detach semantics independent of browser session.

Operations:
- `create_session(workspace_id)`
- `attach(session_id)`
- `send_input(session_id, data)`
- `resize(session_id, cols, rows)`
- `list_sessions(workspace_id)`
- `kill_session(session_id)`

### 6.6 Frontend (mobile-first PWA)
Key views:
- Workspace picker.
- Thread list + search.
- Conversation view with item timeline.
- Approval center (pending command/file/tool input).
- Terminal tab.
- Settings/security tab.

Mobile UX requirements:
- Responsive layout for 390px width baseline.
- Large touch targets for approvals and terminal controls.
- Reconnect logic on network drops.
- Persist selected workspace/thread in local storage.

## 7. Security Architecture

### 7.1 Threat model
Primary risks:
- Unauthorized remote access to shell/file-edit capabilities.
- CSRF/XSS in browser client.
- Path traversal and workspace escape.
- Over-privileged Codex sandbox/approval config.
- Token leakage in logs/local storage.

### 7.2 Controls
Network controls:
- Bind backend to `127.0.0.1` in WSL.
- Expose only through Tailscale Serve.
- Restrict tailnet access using ACL/grants to your own identity/devices.
- Do not use Funnel for this service.

Application controls:
- Require app auth even inside tailnet (long random token or SSO).
- HttpOnly secure cookies for sessions.
- CSRF protection for mutating REST endpoints.
- Strict CORS allowlist (single origin).
- CSP and output escaping.
- Rate-limit login and mutation endpoints.

Execution controls:
- Default `approvalPolicy`: `on-request` for remote sessions.
- Default `sandboxPolicy`: workspace write (not full access).
- Explicit high-risk mode toggle with short TTL and audit event.
- Hard path boundary checks on all workspace/file operations.

Data controls:
- Encrypt session secrets at rest (or avoid storing where possible).
- Redact sensitive payloads in logs.
- Rotate app tokens.
- Keep `capabilities.experimentalApi` disabled by default and gate any experimental app-server use behind feature flags.

## 8. Networking & Deployment Topology (Windows + WSL)

### 8.1 Recommended topology
- Run backend in Ubuntu WSL on `127.0.0.1:8787`.
- Run Tailscale on Windows host.
- Publish service to tailnet via Tailscale Serve on Windows, proxying to local backend.

Why this works well:
- WSL app remains local-only.
- Tailnet clients get encrypted access without opening LAN/public ports.
- Avoids WSL NAT/LAN port forwarding complexity.

### 8.2 Alternate topology
- Run both app + Tailscale inside WSL.
- Use only if you explicitly want Linux-native Tailscale control and accept additional service-management complexity in WSL lifecycle.

## 9. API Contract (draft)

### 9.1 REST endpoints
- `GET /api/health`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `GET /api/workspaces/:id/threads`
- `POST /api/workspaces/:id/threads/start`
- `POST /api/workspaces/:id/threads/:threadId/resume`
- `POST /api/workspaces/:id/threads/:threadId/archive`
- `POST /api/workspaces/:id/turns/start`
- `POST /api/workspaces/:id/turns/steer`
- `POST /api/workspaces/:id/turns/interrupt`
- `POST /api/workspaces/:id/review/start`
- `POST /api/workspaces/:id/approvals/:requestId/respond`
- `GET /api/workspaces/:id/terminals`
- `POST /api/workspaces/:id/terminals`
- `POST /api/terminals/:sessionId/input`
- `POST /api/terminals/:sessionId/resize`
- `DELETE /api/terminals/:sessionId`

### 9.2 WebSocket channels/events
Client subscribes with workspace/thread context.

Server emits:
- `thread.started`
- `turn.started`
- `turn.completed`
- `item.started`
- `item.delta`
- `item.completed`
- `approval.requested`
- `error`
- `terminal.output`

Client emits:
- `approval.respond`
- `tool.user_input.respond`
- `terminal.input`
- `terminal.resize`

## 10. Data Model (SQLite draft)
- `workspaces(id, path, name, trusted, created_at, updated_at)`
- `threads(id, workspace_id, codex_thread_id, title, archived, updated_at)`
- `terminals(id, workspace_id, tmux_session, created_at, last_seen_at)`
- `audit_events(id, ts, actor, workspace_id, event_type, severity, payload_json)`
- `app_sessions(id, user_id, created_at, expires_at, last_ip, user_agent)`

Note: Codex canonical conversation history remains in `~/.codex/sessions/*.jsonl`; DB stores app metadata/indexes.

## 11. Implementation Roadmap

### Phase 0: Foundation (2-3 days)
Deliverables:
- Repo scaffold (backend + frontend packages).
- Local dev scripts.
- Health endpoint + auth skeleton.
- Basic logging and config management.

Exit criteria:
- App boots on WSL and is reachable locally.

### Phase 1: Codex core integration (1 week)
Deliverables:
- App-server manager (spawn + initialize + request/response routing).
- Workspace registration/validation.
- Thread list/start/resume/archive wrappers.
- Basic mobile chat view with streaming text.

Exit criteria:
- Start and complete turns from phone against one workspace.

### Phase 2: Multi-workspace + approvals (1 week)
Deliverables:
- Per-workspace process pool.
- Approval request handling UI and API.
- Error propagation and reconnect handling.
- Thread metadata persistence.

Exit criteria:
- Run multiple workspaces reliably and approve actions from phone.

### Phase 3: Terminal subsystem (1 week)
Deliverables:
- tmux-backed terminal manager.
- Mobile terminal UI with resize/input buffering.
- Session reattach after disconnect.

Exit criteria:
- Stable terminal usage from phone across reconnects.

### Phase 4: Security hardening (1 week)
Deliverables:
- CORS/CSP/CSRF/rate limits.
- Audit log coverage for sensitive actions.
- Default safe policy presets (`on-request`, workspace sandbox).
- Session/token lifecycle hardening.

Exit criteria:
- Threat-model checklist passes and pen-test checklist has no high findings.

### Phase 5: Reliability & ops (1 week)
Deliverables:
- Metrics and structured logs.
- Backup/restore docs for DB state.
- Systemd/pm2 service scripts.
- Runbook for common incidents.

Exit criteria:
- Survives process crash/restart without losing control plane state.

## 12. Testing Strategy

### 12.1 Unit tests
- JSON-RPC framing/parser.
- Workspace path guard logic.
- Approval request lifecycle.
- Auth/session middleware.

### 12.2 Integration tests
- Spawn mock app-server process and simulate notifications.
- End-to-end thread/turn flows.
- Reconnect + resume event streaming.
- Terminal create/attach/kill workflow.

### 12.3 End-to-end mobile tests
- Playwright mobile profiles.
- Network drop/reconnect tests.
- Approval UX on small screens.

### 12.4 Security tests
- Auth bypass attempts.
- CSRF/CORS misconfiguration checks.
- Path traversal payloads.
- XSS payload rendering tests.

## 13. Observability & Operations

### Metrics
- App-server process count and restart rate.
- Turn latency percentiles.
- Approval round-trip latency.
- WS connection count and drop rate.
- Terminal session count.

### Logs
- Correlation id per request + turn.
- Structured JSON logs (no raw secrets).
- Separate audit stream for security actions.

### Runbooks
- App-server stuck/not initialized.
- WSL restart and service recovery.
- Tailscale route/serve health checks.
- Session token revocation.

## 14. Risks and Mitigations

1. Protocol churn in experimental APIs.
Mitigation: use stable v2 methods by default; gate experimental methods behind feature flags.

2. Remote shell exposure risk.
Mitigation: tailnet-only + app auth + strict approval defaults + audit logging.

3. WSL networking surprises.
Mitigation: keep backend loopback-only and rely on Windows Tailscale Serve proxy.

4. Mobile terminal UX complexity.
Mitigation: tmux persistence, throttled rendering, explicit reconnect semantics.

5. Process leaks/zombie subprocesses.
Mitigation: managed process supervisor and idle/LRU cleanup.

## 15. Build-vs-Reuse Recommendation

### Option A: Extend `Codex-webui`
- Pros: fastest start.
- Cons: architectural migration debt (proto-based core).

### Option B: New app-server-native web stack (recommended)
- Pros: protocol-aligned, robust long-term foundation, cleaner security model.
- Cons: more upfront work.

### Option C: Adapt Codexia remote stack
- Pros: feature-rich reference.
- Cons: desktop/Tauri coupling not ideal for pure WSL web deployment.

Recommendation: **Option B**.

## 16. Suggested Initial Backlog (first 10 tasks)

1. Create monorepo skeleton (`apps/backend`, `apps/web`, `packages/shared`).
2. Implement config loader + secrets handling.
3. Build workspace CRUD with path sandbox checks.
4. Implement app-server process wrapper and handshake.
5. Add `thread/list`, `thread/start`, `turn/start` backend routes.
6. Build frontend streaming conversation panel.
7. Add approval request/response pipeline.
8. Integrate tmux terminal manager and WebSocket bridge.
9. Add auth/session middleware and CSRF.
10. Add Playwright mobile smoke tests.

## 17. Explicit Assumptions
- Single primary human operator (you) in v1.
- Codex CLI is installed and authenticated on host.
- Tailscale is available and you can manage ACL/policy settings.
- Main workload is development repositories under known root paths.

## 18. References
- Codex WebUI repo: https://github.com/harryneopotter/Codex-webui
- milisp site: https://www.milisp.dev/
- Codexia repo: https://github.com/milisp/codexia
- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server/
- OpenAI Codex source: https://github.com/openai/codex
- WSL networking docs: https://learn.microsoft.com/en-us/windows/wsl/networking
- WSL advanced config docs: https://learn.microsoft.com/en-us/windows/wsl/wsl-config
- Tailscale Serve/Services docs: https://tailscale.com/kb/1552/tailscale-services/
- Tailscale Funnel docs: https://tailscale.com/kb/1223/tailscale-funnel
- Tailscale HTTPS docs: https://tailscale.com/kb/1153/enabling-https/
