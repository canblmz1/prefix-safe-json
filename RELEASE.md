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
OIDC-based Trusted Publishing (`npm@11.5.1`) and requests `id-token: write`
on the `publish` job. As of the `ci: require npm Trusted Publishing for
releases` change, the actual `npm publish` step no longer receives
`NODE_AUTH_TOKEN` (`secrets.NPM_TOKEN`) at all - the workflow is prepared
to authenticate exclusively through npm CLI's native GitHub Actions OIDC /
Trusted Publishing support.

**This is a repository-side statement only. NPM ACCOUNT / EXTERNAL SECRET
STATE: UNVERIFIED.** Two separate things are unverifiable from this
repository's source alone, and neither should be assumed:

1. Whether npmjs.com actually has a matching Trusted Publisher registered
   for this repository - this must be independently confirmed on
   npmjs.com, or locally via an authenticated `npm trust list
   prefix-safe-json --json`.

   **Two different npm CLI version minimums are in play here, and they
   are not the same thing.** The *publish runtime* minimum - what
   `publish.yml` itself needs to actually publish via Trusted Publishing
   - is `npm >=11.5.1` (already pinned in the workflow's "Ensure npm CLI
   supports Trusted Publishing" step; unchanged by this note). The `npm
   trust` *management* subcommand used above to independently check the
   configuration - run by a maintainer locally, not by the workflow - is
   a separate, newer feature requiring `npm >=11.15.0`. A maintainer
   whose local npm is between those two versions can confirm the
   configuration on npmjs.com's web UI instead; either way, do not
   change the workflow's `11.5.1` pin to satisfy `npm trust` locally -
   that pin is correct and sufficient for what the workflow itself does.
2. Whether the `NPM_TOKEN` GitHub secret referenced below still exists at
   all. Nothing in this repository can enumerate or confirm repository
   secrets; that can only be checked directly in this repository's own
   GitHub Settings -> Secrets and variables -> Actions.

The required npm-side Trusted Publisher configuration is:

- organization or user: `canblmz1`;
- repository: `prefix-safe-json`;
- workflow filename: `publish.yml` (filename only);
- environment: `npm-publish`;
- allowed action: `npm publish`.

Configure this at `npmjs.com -> prefix-safe-json -> Settings -> Trusted
publishing` if it is not already present.

Removing the token from the workflow before independently confirming the
npm-side configuration is deliberate, not an oversight: it means the next
real release is the actual proof. If the npm-side Trusted Publisher is
correctly configured, that release succeeds through OIDC exactly as any
other `npm publish --provenance` would. If it is missing or misconfigured,
`npm publish` fails closed with an authentication error - no publish, no
tag, no GitHub Release (the same `set -euo pipefail` / step-ordering
guarantees that already protect every other publish failure mode) - rather
than silently and ambiguously succeeding via a token fallback that would
leave the actual authentication path unverified. This change does
**not** remove or revoke any GitHub secret - it only stops the workflow
from referencing `NPM_TOKEN`. Whether that secret is still actually
configured on this repository is unverified (see above); this change
does not claim it is. If it is retained as intended, it can serve as an
emergency rollback credential (add the `env:` entry back to the "Publish
to npm" step) until OIDC publishing is proven by a real release.

Only after a real, protected release has actually succeeded through OIDC
and its provenance/source identity has been independently verified should
any retained rollback credential be retired: set npm Publishing access to
"Require two-factor authentication and disallow tokens", revoke the
legacy automation token, and remove the `NPM_TOKEN` GitHub secret if it
is still present. Do not do this before that first real OIDC release has
succeeded - npm does not validate Trusted Publisher fields when they are
saved, so an unverified configuration plus an already-removed rollback
token would leave releases broken with no fallback.

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
