# Chat Image Support (Mobile-First)

## Why This Design

Goal: support image attachments in the existing chat composer with minimal backend complexity and behavior that works well on mobile devices.

## Codex Contract Check (from main Codex repo)

Verified against your local clone at `/mnt/d/projects/codex-from-phone/codex`:

- `codex-rs/app-server-protocol/schema/typescript/UserInput.ts`
  - Supports `input` items with:
    - `{ type: "text", text, text_elements }`
    - `{ type: "image", image_url }`
    - `{ type: "local_image", path }`
- `codex-rs/protocol/src/user_input.rs`
  - `Image` is a pre-encoded data URL.
  - `LocalImage` path is converted later during request serialization.
- `codex-rs/app-server/tests/suite/v2/turn_start.rs`
  - `turn_start_accepts_local_image_input` confirms image-aware turn/start behavior.

Implication for web/mobile: sending `{ type: "image", image_url: "data:image/...;base64,..." }` is the right direct path.

## Implemented in PocketCodex

### Composer UX

- Added mobile-friendly image actions:
  - `Add Image` (gallery/files)
  - `Camera` (capture from device camera)
- Added inline image attachment chips with:
  - thumbnail
  - dimensions + size + source
  - remove button
- Allowed image-only turn submission (text is now optional when images exist).

### Attachment Pipeline

- Client-side validation and compression before send:
  - image-only file type check
  - source file size guard
  - resize to max dimension
  - PNG fallback to JPEG when needed
  - iterative quality/size reduction
- Per-image and total payload limits enforced client-side.
- Payload format on turn submit:
  - text item when prompt exists
  - one `image` item per attachment using `image_url` data URL

### Draft + Context Behavior

- Draft cache now stores both:
  - text draft
  - image attachments
- Drafts remain context-aware per workspace/thread.
- If image processing finishes after context switch, attachment is stored in the original draft context.

### Runtime/Backend Safety

- Increased backend JSON body limit to `8 MB` to support compressed image payloads from mobile clients.

## Files Changed

- `apps/web/src/state/app-state.ts`
- `apps/web/src/ui/app-shell.ts`
- `apps/web/src/ui/app-renderer.ts`
- `apps/web/src/styles.css`
- `apps/web/src/main.ts`
- `apps/web/src/lib/thread-transcript.ts`
- `apps/web/test/unit/thread-transcript.test.ts`
- `apps/web/test/unit/selectors.test.ts`
- `apps/web/test/unit/store.test.ts`
- `apps/backend/src/app.ts`

## Validation Completed

- `pnpm --filter @poketcodex/web test:unit`
- `pnpm --filter @poketcodex/web lint`
- `pnpm --filter @poketcodex/web build`
- `pnpm --filter @poketcodex/backend lint`
- `pnpm --filter @poketcodex/backend build`
- `pnpm --filter @poketcodex/backend test:unit`

## Recommended Next Improvements

1. Add optional image preview modal (tap thumbnail).
2. Add drag-and-drop image attach for desktop.
3. Add adaptive compression presets (faster vs clearer).
4. Add server-side upload endpoint + `local_image` path mode for very large images.
5. Add usage telemetry for attachment success/failure and compression time on mobile.
