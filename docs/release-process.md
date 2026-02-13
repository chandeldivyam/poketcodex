# Release Process

This repository uses a Release PR bot (Release Please) to automate versioning and GitHub Releases.

## Why this model

- No manual tag creation in normal operation.
- Release cadence is controlled (not every merge to `main` becomes a release).
- Every release is tied to a reviewed Release PR.
- Installer assets are still published automatically after release creation.

## End-to-end flow

1. Create a feature branch (`feat/xyz`), open PR, and merge into `main`.
2. A push to `main` triggers `.github/workflows/release-please.yml`.
3. Release Please opens or updates a Release PR (example title: `chore(main): release ...`).
4. Review and merge the Release PR when you want to ship.
5. On the next `main` push, Release Please creates:
   - a new semantic version tag (for example `v0.2.0`)
   - a GitHub Release for that tag
   - changelog updates
6. The existing `.github/workflows/release-installer-assets.yml` runs on `release.published` and uploads:
   - `install.sh`
   - `poketcodex-source.tar.gz`
   - `checksums.txt`

## Commit message conventions

Release Please infers version bumps from conventional commit types:

- `feat:` => minor release bump
- `fix:` => patch release bump
- `feat!:` or `fix!:` or `BREAKING CHANGE:` => major release bump
- `chore:`, `docs:`, `refactor:` typically do not bump unless configured otherwise

Use conventional commits in PR branch history (or squash commit title) for predictable versioning.

## Operational guidance

- Treat Release PR merge as the "ship" action.
- Keep `release-installer-assets.yml` as automatic post-release publishing.
- Keep manual `workflow_dispatch` on `release-installer-assets` only as fallback/recovery.
- Keep feature work flowing into `main`; Release Please continuously refreshes the same Release PR until you merge it.

## First-run bootstrap note

The manifest file `.release-please-manifest.json` is initialized to the current root package version (`0.1.0`).
If this version changes manually, keep both `package.json` and the manifest aligned.
