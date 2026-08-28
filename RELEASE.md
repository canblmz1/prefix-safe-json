# Release Process

This describes how a `prefix-safe-json` release actually happens, and the
quality bar `.github/workflows/publish.yml` enforces automatically. It is a
description of the real automated process, not a manual checklist to
perform by hand - the steps below happen in CI, not on a maintainer's
machine.

## 1. What triggers a release

`publish.yml` runs on every push to `main` that changes `package.json`. A
cheap `release-intent` job checks whether `package.json`'s `version` is
already published on npm:

- Confirmed unpublished (`npm view` returns a structured `E404`) → the full
  validation chain below runs.
- Confirmed already published, or the lookup fails ambiguously (network/auth/
  timeout - never assumed to mean "unpublished") → nothing further runs.
  A version-only-unrelated `package.json` edit (a devDependency bump, for
  example) takes this path and costs nothing.

So the practical release flow is: open a PR that bumps `package.json`'s
`version` and adds the corresponding `CHANGELOG.md` entry, get it reviewed,
merge it to `main`.

## 2. What runs automatically once should_publish is true

- The full Node 22/24 × Linux/Windows/macOS test matrix.
- A dedicated coverage job: statements/branches/functions/lines all `>=95%`.
- Mutation testing (`stryker run`): `thresholds.break: 85.01` (Stryker's own
  semantics: `score < break` fails the job - 85.01 is the smallest value
  making that equivalent to a strict `>85%` requirement).
- A release-grade fuzz soak: `test:fuzz` looped until wall-clock time
  reaches 10+ minutes, not a fixed iteration count.

All four run in parallel and are all required.

## 3. Manual authorization gate

Passing every job above does **not** publish anything by itself. The
`publish` job requires the `npm-publish` GitHub Environment, which has a
required reviewer configured - publishing needs an explicit "approve
deployment" click in the Actions UI after the validation above has already
passed. This is the actual release-authorization step; merging the
version-bump PR is not it.

## 4. What the publish job does, in order

1. Re-typechecks/lints/tests/builds fresh (not reused from the matrix jobs
   above - this job runs in its own clean checkout).
2. Runs the example scripts end-to-end.
3. `pnpm pack --dry-run` and a production-dependency audit
   (`pnpm audit --prod`).
4. Generates and verifies a deterministic CycloneDX 1.6 JSON SBOM from the
   frozen production dependency graph, then preserves it as a workflow
   artifact.
5. Installs the actual packed tarball into a scratch project and imports it
   - not source, not a workspace symlink.
6. A **second**, exact-version npm lookup, immediately before publishing -
   closes the TOCTOU window the ~30+ minute gate chain above would
   otherwise leave open between the first check and the actual publish.
   If this recheck finds the version now published (a race with some other
   process), publish is skipped rather than retried or forced.
7. `npm publish --access public --provenance` - Sigstore-signed provenance
   attached, verifiable via `npm view <pkg>@<version> dist --json` after the
   fact.
8. Only after publish succeeds: tags the release (`vX.Y.Z`, pointing at the
   commit that was actually published) and creates a GitHub Release with the
   verified SBOM attached.

If step 7 fails, nothing after it runs - no tag, no release, matching what
was actually published (nothing). If step 7 succeeds but step 8 fails, the
package is already live on npm; that partial state needs manual recovery
(create the tag/release by hand pointing at the right commit), never a
second `npm publish` attempt for the same version.

## 5. Benchmarks: informational, not a release gate

`npm run bench` is not run by any workflow and does not gate a release.
This is a deliberate choice, not an oversight: no benchmark baseline is
committed anywhere in this repository to compare a run against, and
inventing a pass/fail threshold without one would be exactly the kind of
number that looks rigorous but isn't. Run `npm run bench` manually before a
release if you want a sanity check against the previous release's own
manual run; treat any large swing as worth investigating, not as a gate
that blocks the release either way.

## 6. Node / OS / package hygiene, checked but not covered above

- `engines.node` and the CI matrix are Active LTS Node lines only - see
  `docs/COMPATIBILITY.md`.
- The packed tarball's contents are checked against the `files` allowlist
  in `package.json` (`dist`, `LICENSE*`, `README.md`) as part of step 3
  above - nothing else should ever be in it.
- Public API surface (`src/index.ts`) and its Stable/Experimental
  classification should be reviewed for accidental exposure before opening
  the version-bump PR - see `docs/COMPATIBILITY.md`'s versioning policy.

## 7. Trusted Publishing

`publish.yml` pins the npm CLI to the exact version npm requires for
OIDC-based Trusted Publishing and requests `id-token: write`, but the
actual publish auth path today is still `NODE_AUTH_TOKEN`
(`secrets.NPM_TOKEN`). The npm-side Trusted Publisher configuration could
not be authenticated and inspected during Trust Baseline v1, so OIDC-only
publishing is **not claimed** and the functional token path remains.

Before removing `NPM_TOKEN`, an npm package owner must open
`npmjs.com -> prefix-safe-json -> Settings -> Trusted publishing`, configure
GitHub Actions with these exact values, and verify them with an authenticated
`npm trust list prefix-safe-json --json`:

- organization or user: `canblmz1`;
- repository: `prefix-safe-json`;
- workflow filename: `publish.yml` (filename only);
- environment: `npm-publish`;
- allowed action: `npm publish`.

After that configuration is independently confirmed, remove the workflow's
`NODE_AUTH_TOKEN` environment entry, run one normal versioned release through
the protected environment, confirm provenance, set npm Publishing access to
"Require two-factor authentication and disallow tokens", revoke the legacy
automation token, and remove the `NPM_TOKEN` GitHub secret. Do not reverse
that order: npm does not validate Trusted Publisher fields when they are
saved, and removing the token first could break releases.

## 8. Production SBOM

`pnpm run sbom:generate` emits deterministic CycloneDX 1.6 JSON under
`artifacts/`. It uses `pnpm list --prod --depth Infinity --json` after the
frozen install, excludes development tooling, records the exact resolved
production versions and dependency edges, and contains no local filesystem
paths or generation timestamp.

Verify an artifact against the current frozen production graph with:

```console
pnpm run sbom:generate
pnpm run sbom:verify
```

CI preserves a verified SBOM for 14 days. A future release run preserves it
for 90 days as a workflow artifact and attaches the same file to the GitHub
Release. This change does not retrofit an SBOM onto existing releases.

## 9. Repository governance baseline

As of 2026-08-28, `main` requires a pull request and the repository's named
CI/CodeQL/dependency-review checks. Repository-role bypass actors were
removed from that ruleset. The `npm-publish` environment is restricted to
`main`, requires an explicit reviewer, and no longer permits administrators
to bypass its protection rules.

This remains a single-maintainer project. Required PR approvals remain zero
and environment self-review remains allowed because enabling either control
without an independent reviewer would make the project unreleasable rather
than independent. Those are residual governance risks, not solved controls.
