# Releasing

Releases are **fully automated** with
[release-please](https://github.com/googleapis/release-please). You never edit
the version, write `CHANGELOG.md`, create tags, or run `npm publish` by hand.
All of that is derived from your commit messages.

## Day-to-day flow

1. Create a branch and make your changes.
2. Open a PR. Give it a **Conventional Commit title** — this is what determines
   the next version when the PR is squash-merged:
   | PR title prefix | Example | Version bump |
   |---|---|---|
   | `fix:` | `fix: handle 401 during poll` | patch (3.4.8 → 3.4.9) |
   | `feat:` | `feat: add fan speed control` | minor (3.4.8 → 3.5.0) |
   | `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer | `feat!: drop Node 18` | major (3.4.8 → 4.0.0) |
   | `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | `docs: fix typo` | no release |
3. The **Tests** workflow runs on the PR. Merge it to `master`.
4. **release-please** automatically opens (or updates) a **Release PR** titled
   like `chore(main): release 3.5.0`. It contains the version bump in
   `package.json` and the generated `CHANGELOG.md` entries. Review it.
5. **Merge the Release PR.** That triggers:
   - a `vX.Y.Z` git tag,
   - a GitHub Release with the changelog notes,
   - `npm publish` (with provenance) via the `publish` job.

So each release is: merge your code PR(s), then one click to merge the Release
PR. Multiple feature PRs merged before you release are batched into a single
Release PR.

## One-time setup (required, done on npmjs.com — only the package owner)

Publishing uses **npm Trusted Publishing (OIDC)**, so there is **no `NPM_TOKEN`
secret**. Link the package to this repo's workflow once:

1. Sign in at <https://www.npmjs.com> as the package owner.
2. Package page → **Settings → Trusted Publisher** (OIDC / "Publishing access").
3. Add a **GitHub Actions** trusted publisher:
   - **Organization / user:** `tbaur`
   - **Repository:** `homebridge-myleviton`
   - **Workflow filename:** `release.yml`
   - **Environment:** leave blank
4. Save.

The package already exists on npm, so no manual first publish is needed. This
link only has to exist before the first Release PR is merged.

## Notes & gotchas

- **PR titles matter.** With squash merges, the PR title becomes the commit
  release-please reads. A `chore:`/`docs:` title produces no release — that's
  expected.
- **The Release PR doesn't re-run the Tests workflow.** GitHub does not trigger
  workflows for PRs opened by the built-in token (loop prevention). Your code
  was already tested on its own PR; the `publish` job also builds/lints/tests
  before publishing, so nothing ships untested.
- **Version source of truth** is `.release-please-manifest.json` (currently
  `3.4.8`). Don't hand-edit `package.json`'s version anymore — let release-please
  own it.
- Config lives in `release-please-config.json`.

## Manual fallback (rarely needed)

If you must publish from your machine:

```bash
npm run clean && npm run build && npm run lint && npm test
npm publish --dry-run   # verify contents
npm publish             # requires npm login + OTP
```

Prefer the automated flow; manual publishes won't have CI provenance and will
desync the manifest.
