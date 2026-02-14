# Runtime Event Reference

Last updated: 2026-02-14.

This document catalogs runtime websocket events observed from the backend and explains what they mean in the current app.

## Capture Scope

Observed against a running local backend at `http://127.0.0.1:8787` for workspace `/Users/divyamchandel/Documents/projects/poketcodex`.

Prompts used during capture:

1. `Can you please do an audit of the frontend? How is everythign? Keep it brief.`
2. `Run \`ls -1 apps/web/src | head -n 5\` and tell me what you see.`
3. File-change probes (shell write and explicit `apply_patch`) to force file-change events.

Primary capture totals:

1. `5,129` websocket messages
2. `5,128` `workspace_runtime_event` envelopes
3. Runtime kinds observed: `notification` (`5,116`) and `stderr` (`12`)

## Event Transport

Websocket endpoint:

1. `/api/workspaces/:workspaceId/events` (`apps/backend/src/events/workspace-events-plugin.ts`)

Envelope examples:

```json
{ "type": "connected", "workspaceId": "..." }
```

```json
{
  "type": "workspace_runtime_event",
  "event": {
    "workspaceId": "...",
    "sequence": 1441,
    "timestamp": "2026-02-14T05:08:00.000Z",
    "kind": "notification",
    "payload": { "method": "item/reasoning/summaryTextDelta", "params": { "...": "..." } }
  }
}
```

Possible backend runtime kinds (`apps/backend/src/codex/workspace-app-server-pool.ts`):

1. `notification`
2. `serverRequest`
3. `staleResponse`
4. `stateChanged`
5. `stderr`

Only `notification` and `stderr` were observed in this run.

## Why The Runtime Panel Feels Truncated

Current UI behavior:

1. Stored events are capped at `240` (`MAX_STORED_EVENTS` in `apps/web/src/main.ts`).
2. Rendered events are capped at `100` (`MAX_RENDERED_EVENTS` in `apps/web/src/ui/app-renderer.ts`).
3. `Show Status` is off by default.
4. `Show Internal` is off by default.
5. Status bursts are compacted by default (`compactStatusBursts=true`), which collapses repeated status events.

Because `item/reasoning/summaryTextDelta` and other delta events are high volume, they quickly push older events out of the 100-row rendered window.

## Observed Methods (34)

Methods below are grouped by channel.

### Runtime/Public Channel Methods

| Method | Count | Typical params shape | Meaning |
| --- | ---: | --- | --- |
| `account/rateLimits/updated` | 73 | `rateLimits` | Account/model limit updates. |
| `item/agentMessage/delta` | 1067 | `threadId, turnId, itemId, delta` | Assistant text stream delta (chat output). |
| `item/commandExecution/outputDelta` | 16 | `threadId, turnId, itemId, delta` | Streaming output from command execution items. |
| `item/completed` | 79 | `item, threadId, turnId` | Item finished (message/tool/reasoning/file change/etc). |
| `item/fileChange/outputDelta` | >=1 | `threadId, turnId, itemId, delta` | Streaming patch/file-change result text. |
| `item/reasoning/summaryPartAdded` | 22 | `threadId, turnId, itemId, summaryIndex` | New reasoning summary section started. |
| `item/reasoning/summaryTextDelta` | 420 | `threadId, turnId, itemId, delta, summaryIndex` | Reasoning summary token deltas. |
| `item/started` | 77 | `item, threadId, turnId` | Item started (user message, reasoning, tool, etc). |
| `thread/tokenUsage/updated` | 71 | `threadId, turnId, tokenUsage` | Thread-scoped token usage updates. |
| `turn/completed` | 3 | `threadId, turn` | Turn reached terminal success state. |
| `turn/diff/updated` | >=1 | `threadId, turnId, diff` | Turn-level unified diff update emitted after edits. |
| `turn/started` | 3 | `threadId, turn` | Turn entered in-progress state. |

### Internal Mirror/Diagnostic Methods (`codex/event/*`)

| Method | Count | Typical params shape | Meaning |
| --- | ---: | --- | --- |
| `codex/event/agent_message` | 12 | `id, msg, conversationId` | Full assistant message chunks/checkpoints. |
| `codex/event/agent_message_content_delta` | 1067 | `id, msg, conversationId` | Rich assistant content deltas (thread/turn/item IDs embedded in `msg`). |
| `codex/event/agent_message_delta` | 1067 | `id, msg, conversationId` | Assistant text delta mirror. |
| `codex/event/agent_reasoning` | 22 | `id, msg, conversationId` | Reasoning status message checkpoints. |
| `codex/event/agent_reasoning_delta` | 420 | `id, msg, conversationId` | Reasoning text delta mirror. |
| `codex/event/agent_reasoning_section_break` | 22 | `id, msg, conversationId` | Reasoning section boundaries. |
| `codex/event/collab_waiting_end` | 1 | `id, msg, conversationId` | Collaboration wait completion signal. |
| `codex/event/exec_command_begin` | 36 | `id, msg, conversationId` | Command execution started (`call_id`, `process_id`, `command`, `cwd`, `source`). |
| `codex/event/exec_command_end` | 36 | `id, msg, conversationId` | Command execution ended (`stdout`, `stderr`, `exit_code`). |
| `codex/event/exec_command_output_delta` | 16 | `id, msg, conversationId` | Streaming command output chunks. |
| `codex/event/item_completed` | 42 | `id, msg, conversationId` | Internal mirror for item completion. |
| `codex/event/item_started` | 41 | `id, msg, conversationId` | Internal mirror for item start. |
| `codex/event/mcp_startup_complete` | 1 | `id, msg, conversationId` | MCP startup completion summary. |
| `codex/event/mcp_startup_update` | 1 | `id, msg, conversationId` | MCP server startup state transition. |
| `codex/event/patch_apply_begin` | >=1 | `id, msg, conversationId` | Patch apply started (`changes` contains file-level diff payload). |
| `codex/event/patch_apply_end` | >=1 | `id, msg, conversationId` | Patch apply ended (`success`, `stdout`, `changes`). |
| `codex/event/reasoning_content_delta` | 420 | `id, msg, conversationId` | Reasoning content delta mirror. |
| `codex/event/task_complete` | 3 | `id, msg, conversationId` | Turn/task terminal message with `last_agent_message`. |
| `codex/event/task_started` | 1 | `id, msg, conversationId` | Task start metadata (`turn_id`, context window). |
| `codex/event/token_count` | 73 | `id, msg, conversationId` | Token usage + rate limit details. |
| `codex/event/turn_diff` | >=1 | `id, msg, conversationId` | Internal unified diff payload emitted after edits. |
| `codex/event/user_message` | 4 | `id, msg, conversationId` | User input mirror event. |

## Key Payload Examples

Reasoning delta:

```json
{
  "method": "item/reasoning/summaryTextDelta",
  "params": {
    "threadId": "...",
    "turnId": "...",
    "itemId": "rs_...",
    "summaryIndex": 0,
    "delta": "frontend"
  }
}
```

Command start:

```json
{
  "method": "codex/event/exec_command_begin",
  "params": {
    "id": "...",
    "conversationId": "...",
    "msg": {
      "type": "exec_command_begin",
      "call_id": "call_...",
      "process_id": "...",
      "command": ["/bin/zsh", "-lc", "rg --files"],
      "cwd": "/Users/divyamchandel/Documents/projects/poketcodex",
      "source": "unified_exec_startup"
    }
  }
}
```

Patch begin + file change output:

```json
{
  "method": "codex/event/patch_apply_begin",
  "params": {
    "msg": {
      "type": "patch_apply_begin",
      "call_id": "call_...",
      "auto_approved": true,
      "changes": {
        "/Users/divyamchandel/Documents/projects/poketcodex/docs/runtime-events-probe-note.txt": {
          "type": "update",
          "unified_diff": "@@ -1 +1,2 @@ ...",
          "move_path": null
        }
      }
    }
  }
}
```

```json
{
  "method": "item/fileChange/outputDelta",
  "params": {
    "threadId": "...",
    "turnId": "...",
    "itemId": "call_...",
    "delta": "Success. Updated the following files:\\nM docs/runtime-events-probe-note.txt\\n"
  }
}
```

## Frontend Handling Notes

`apps/web/src/main.ts` currently applies transcript updates for:

1. `item/agentMessage/delta`
2. `item/reasoning/summaryTextDelta`
3. `item/reasoning/textDelta` (recognized in code path, not observed in this run)
4. `item/reasoning/contentDelta` (recognized in code path, not observed in this run)
5. `item/started`
6. `item/updated` (recognized in code path, not observed in this run)
7. `item/completed`

Turn status transitions are inferred from:

1. `turn/started`
2. `turn/completed`
3. `turn/interrupted`, `turn/failed`, `turn/cancelled`, `turn/aborted`, `turn/error` (recognized in code path, not observed in this run)

## Practical Debugging Checklist

1. Enable both `Show Status` and `Show Internal`.
2. Disable compacting if you need raw status granularity.
3. Use a file-edit prompt that explicitly asks for `apply_patch` to surface `item/fileChange/outputDelta`, `turn/diff/updated`, and patch events.
4. If you need full fidelity, inspect websocket payloads directly; the panel intentionally renders only the latest 100 events.
