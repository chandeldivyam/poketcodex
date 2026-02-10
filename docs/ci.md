# CI Quality Gates

The repository uses `.github/workflows/ci.yml` as the required validation pipeline.

## Jobs

- `quality-gates`: Runs lint, typecheck, unit tests, integration tests, and build.
- `backend-smoke`: Builds backend and verifies `/api/health` responds from a real process.
- `dependency-audit`: Runs `pnpm audit --audit-level=high`.

## Branch protection guidance

Mark all three jobs as required checks for `main` branch protection:

- `Quality Gates`
- `Backend Smoke`
- `Dependency Audit`
