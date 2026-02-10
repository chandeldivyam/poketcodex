# Backend Configuration

PocketCodex backend reads configuration from environment variables and validates it before boot.

## Required variables

- `SESSION_SECRET`: Session signing key (minimum 32 characters).
- `CSRF_SECRET`: CSRF token signing key (minimum 32 characters).
- `AUTH_PASSWORD`: Password for single-user login (minimum 12 characters).
- `ALLOWED_WORKSPACE_ROOTS`: Comma-separated absolute paths used as workspace allowlist roots.

## Optional variables

- `NODE_ENV`: `development`, `test`, or `production` (default `development`).
- `HOST`: Bind host (default `127.0.0.1`).
- `PORT`: Bind port (default `8787`).
- `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` (default `info`).
- `AUTH_MODE`: Currently supports `single_user`.
- `COOKIE_SECURE`: Boolean-like value (`true/false/1/0`) for cookie secure flag.
- `SESSION_TTL_MINUTES`: Session TTL in minutes (default `1440`).

## Behavior

- Backend startup fails fast on invalid or missing required values.
- Startup logs include a redacted config payload so secrets are never printed in plaintext.
