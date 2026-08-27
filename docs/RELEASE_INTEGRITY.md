# Release integrity

This document records independently rechecked release evidence. It is not a
promise about future artifacts. Re-run the commands in
[`MAINTAINER_AUDIT.md`](MAINTAINER_AUDIT.md) before making a trust decision.

## Verified baseline — 0.4.2 (2026-08-27)

The default GitHub branch was `main`; `origin/main` resolved to the exact
same commit as tag `v0.4.2`.

| Field | Verified value |
| --- | --- |
| npm `latest` | `0.4.2` |
| npm `next` | `0.0.1-alpha.4` |
| GitHub release/tag | `v0.4.2` |
| release commit | `8443e5f20d21d7b85e7568e97205645e92e0dfd4` |
| npm `gitHead` | **absent** (see note below; this differs from `0.4.1`) |
| registry tarball | `https://registry.npmjs.org/prefix-safe-json/-/prefix-safe-json-0.4.2.tgz` |
| packed bytes | `110575` |
| unpacked bytes | `496543` |
| files | `141` |
| SHA-1 / npm `dist.shasum` | `9d069c431890d7ff06e86866f8d4dd2e0bbc9437` |
| SHA-256 | `94d308d26d09c1ecf0cb77a362a39a4c5938021295e7bd82b6ae987529a5e87b` |
| SHA-512 (hex) | `cfa212385cc1e65ea6438293c9d61125b3499e9fb482f30b582fd6825d9a8dc004042829a931e7c4fad8a34ffb0e88af0d95b7874ae499cefe98d7df5bbb4c3c` |
| npm `dist.integrity` | `sha512-z6ISOFzB5l6mQ4KTydYRJbNJnp+0gvMLWC/Wgl2ajcAEBCgpqTHnxPrYo0/7DoivDZW3h0rkmc7+mNffW7tMPA==` |
| provenance | SLSA provenance v1 present; subject SHA-512 matches the tarball |

The release commit is a GitHub-verified merge commit. GitHub release `v0.4.2`
was published at `2026-08-27T08:20:17Z`. Publish workflow run
`https://github.com/canblmz1/prefix-safe-json/actions/runs/33051234174`
concluded `success` with `head_sha` equal to the release commit above.

**`gitHead` is absent from `0.4.2`'s npm metadata**, unlike `0.4.1`'s. The
`publish` job (`.github/workflows/publish.yml`) packs one tarball with `npm
pack`, smoke-tests that exact file, then runs `npm publish <tarball-path>`
against it instead of re-packing the working directory — deliberately, so
the artifact that was tested is guaranteed to be the artifact that gets
published. `npm publish` given an explicit tarball path skips the git-aware
packing step that would otherwise populate `gitHead`. This is a side effect
of a real integrity improvement, not a loss of verifiability: the SLSA
provenance attestation below independently binds this npm package version to
release commit `8443e5f20d21d7b85e7568e97205645e92e0dfd4` with a
cryptographically verified statement — the same binding `gitHead` would have
offered, at a stronger level (see the three-tier distinction below). This is
expected to recur for every future release published this way.

`scripts/verify-published-release.mjs` now establishes the authoritative
release commit through one policy, not through `gitHead` alone. It
distinguishes three separate things, none of which stands in for another:

1. **Provenance claims decoded and content-matched**: the DSSE payload
   parses as JSON and its self-reported subject digest, repository, and
   workflow path match what is expected. On its own this proves nothing —
   anyone can construct JSON that parses and has matching fields.
2. **Provenance cryptographically verified**: the attestation's signature
   itself checks out against Sigstore, via a pinned `npm audit signatures`
   run in an isolated, disposable install of this exact package version
   (`scripts/verify-published-release.mjs`'s `verifyProvenanceCryptographically`)
   — not by decoding JSON. This is required before step 1's content is
   trusted for anything; content that would otherwise be perfectly valid
   still fails closed without it.
3. **Reproducible rebuild**: once an authoritative release commit is
   established (below), the package is independently rebuilt from that
   exact commit and compared byte-for-byte against the published tarball —
   see "Reproduction result" below.

Identity policy, requiring (2) wherever provenance is used at all:

- **`gitHead` present** (e.g. `0.4.1`): tag commit, npm `gitHead`, and — when
  provenance is available — the cryptographically verified, content-matched
  provenance source commit must all agree. This is the original policy,
  preserved unweakened; if provenance happens to be unavailable it is simply
  not cross-checked, exactly as before this fallback existed.
- **`gitHead` absent** (e.g. `0.4.2`): cryptographically verified provenance
  becomes *required*. The provenance statement's repository, workflow path,
  and subject SHA-512 (against the independently downloaded tarball) are
  validated only after its signature has verified; only then may its source
  commit — checked against the Git tag commit — stand in for the missing
  `gitHead`.
- **Either way, if the required identities disagree, if provenance is
  absent/malformed/ambiguous when `gitHead` is absent, or if provenance is
  present but its signature does not verify: the verifier fails closed.** It
  never accepts the GitHub tag alone, never treats a missing `gitHead` as
  something to silently work around, and never treats matching JSON content
  as a substitute for a verified signature.

## Reproduction result — 0.4.2

`npm run verify:published-release -- 0.4.2` now passes end to end, with no
manual workaround: it establishes `8443e5f20d21d7b85e7568e97205645e92e0dfd4`
as the release commit via the provenance-fallback policy above
(`sourceIdentityMethod: "provenance"` in its result JSON), then rebuilds
from that exact commit and compares against the downloaded tarball exactly
as it does for a release with `gitHead` present: `pnpm@10.33.1` with a
frozen lockfile, `pnpm run clean`, `pnpm run build`, and the publish
workflow's exact `npm@11.5.1` packer, then a per-file SHA-256 manifest
comparison of both unpacked trees plus a direct byte comparison of both
`.tgz` files.

| Question | Result |
| --- | --- |
| Rebuilt `.tgz` byte-identical to npm | **YES** |
| All unpacked files byte-identical | **YES** |
| Published manifest entries | `141` |
| Rebuilt manifest entries | `141` |
| Per-file manifest differences | `0` |

No file content was normalized during comparison. As with `0.4.1`,
`core.autocrlf=false` was required for a clean result: a first attempt built
directly inside an already-checked-out Windows worktree (this machine's
`core.autocrlf=true`, no repository `.gitattributes` overriding it) and
produced 5 false-positive text-file differences — `LICENSE`,
`LICENSE-APACHE`, `LICENSE-MIT`, `README.md`, and `package.json`, each
inflated by CRLF line-ending conversion — while all 136 `dist/**` files
already matched exactly in that first attempt. Re-running from a `git
archive --output=... -c core.autocrlf=false` export (matching what the
official script does) eliminated all 5 differences.

`0.4.2`'s published `dist/` is also byte-for-byte identical to `0.4.1`'s
published `dist/` (`diff -rq` of both unpacked tarballs' `dist/` trees: no
differences), and `git diff --stat 2d2dc5ae5d83d8db73d485ade2872939459bdc09
8443e5f20d21d7b85e7568e97205645e92e0dfd4 -- src/` is empty. The entire
release-to-release diff touches only `.github/workflows/{ci,publish}.yml`,
`README.md`, this record and the other three `docs/*.md` files it lives
alongside, the two new `scripts/verify-*.mjs` maintainer tools, and a
`package.json` version bump plus those two new script entries.
**`0.4.2` ships zero runtime code changes relative to `0.4.1`.**

## Provenance mapping — 0.4.2

```text
https://registry.npmjs.org/-/npm/v1/attestations/prefix-safe-json@0.4.2
```

The SLSA v1 statement records:

- subject `pkg:npm/prefix-safe-json@0.4.2` with the SHA-512 above;
- repository `https://github.com/canblmz1/prefix-safe-json`;
- workflow `.github/workflows/publish.yml` at `refs/heads/main`;
- source commit `8443e5f20d21d7b85e7568e97205645e92e0dfd4`;
- GitHub-hosted Actions builder;
- invocation `https://github.com/canblmz1/prefix-safe-json/actions/runs/33051234174/attempts/1`.

This statement's signature is cryptographically verified as part of
`npm run verify:published-release` itself, not merely decoded: the verifier
installs this exact version into an isolated, disposable directory with a
pinned `npm@11.5.1`, confirms that install's own resolved integrity matches
the already-downloaded-and-hashed tarball, then runs `npm audit signatures`
against it. That run reported zero invalid or missing signatures and one
verified attestation — unchanged in shape from `0.4.1` (six verified
registry signatures, one verified attestation), since the production
dependency graph did not change (see
[`RUNTIME_DEPENDENCIES.md`](RUNTIME_DEPENDENCIES.md)). Only after this
succeeds does the verifier decode the statement's content at all.

Cryptographic verification proves this exact attestation was really signed
and recorded the way Sigstore attests. Provenance overall — verified
signature plus matched content — binds an artifact digest to a repository,
workflow, and commit. It does **not** prove the source is correct, the
workflow is uncompromised, the dependencies are safe, or the runtime
behavior matches a reviewer's policy. The independent rebuild (above) and
source audit remain necessary.

## Verified baseline — 0.4.1 (2026-08-27)

The default GitHub branch was `main`. The audit began from local HEAD
`4ccc5ff22afb344f08ac04c9da5e5376e0857494` (`release/0.4.1`), then fetched
`origin` and independently resolved the release from the default branch.

| Field | Verified value |
| --- | --- |
| npm `latest` | `0.4.1` |
| npm `next` | `0.0.1-alpha.4` |
| GitHub release/tag | `v0.4.1` |
| release commit | `2d2dc5ae5d83d8db73d485ade2872939459bdc09` |
| npm `gitHead` | `2d2dc5ae5d83d8db73d485ade2872939459bdc09` |
| registry tarball | `https://registry.npmjs.org/prefix-safe-json/-/prefix-safe-json-0.4.1.tgz` |
| packed bytes | `110234` |
| unpacked bytes | `495775` |
| files | `141` |
| SHA-1 / npm `dist.shasum` | `7d9216f8d1730ac41890ef2c90a0f50cc657dbca` |
| SHA-256 | `46b13f717cc7336558143b6abae4f41d433a064db87f0eaf8fe9d6c749c3a29c` |
| SHA-512 (hex) | `5cba70d34442fb39754af61cb7de5e8c60b750f1fbfcc0fcff5a2520b78f57cd4c84b4692f086b3e5771e4e6f9a7c7f208f524e150b10ba15fd8ff511476cf7e` |
| npm `dist.integrity` | `sha512-XLpw00RC+zl1SvYct95ejGC3UPH7/MD8/1olILePV81MhLRpLwhrPldx5Ob5p8fyCPUk4VCxC6Ff2P9RFHbPfg==` |
| provenance | SLSA provenance v1 present; subject SHA-512 matches the tarball |

The release commit is a GitHub-verified merge commit. GitHub release `v0.4.1`
was published at `2026-08-25T14:29:19Z`.

## Reproduction result — 0.4.1

The release was rebuilt from the exact Git commit using the repository's
`pnpm@10.33.1` pin, a frozen lockfile, `pnpm run clean`, `pnpm run build`, and
the publish workflow's exact `npm@11.5.1` packer.

| Question | Result |
| --- | --- |
| Rebuilt `.tgz` byte-identical to npm | **YES** |
| All unpacked files byte-identical | **YES** |
| Published manifest entries | `141` |
| Rebuilt manifest entries | `141` |
| Per-file manifest differences | `0` |

No file content was normalized during comparison. On Windows, a normal
checkout with global `core.autocrlf=true` changes README/license line endings.
The verifier therefore uses `git -c core.autocrlf=false archive` to extract the
bytes stored in the release commit. That controls source extraction; it does
not rewrite either package after packing. With canonical Git blob bytes and
the exact npm packer, the raw gzip/tar bytes also reproduced.

Run the verifier from a clone containing the release tag:

```console
git fetch origin --tags
npm run verify:published-release -- 0.4.1
```

It fetches exact registry metadata, verifies SHA-1 and SRI SHA-512, resolves
`v0.4.1` against npm `gitHead`, checks the provenance subject/commit, exports
the release commit, performs a frozen install/build/pack, and emits
`published-manifest.json`, `rebuilt-manifest.json`, `manifest-diff.json`, and
`result.json` in the printed temporary audit directory. A content difference
is a hard failure. Tarball-byte identity is reported separately.

## Published content

The artifact contains only:

- 34 runtime `.js` files (`215757` bytes);
- 34 declaration `.d.ts` files (`70974` bytes);
- 68 JavaScript/declaration source maps (`173980` bytes);
- `package.json` (`3145` bytes);
- README and three license files (`31919` bytes).

`0.4.2` matches exactly on the first three (independently confirmed via a
direct `dist/` diff against `0.4.1`, above); `0.4.2`'s `package.json` is
`3293` bytes (the version bump plus two new script entries) and its README
plus three license files total `32539` bytes.

All archive members were regular, non-executable files with no hidden paths,
symlinks, native binaries, or bundled dependency directories. A credential
marker scan found only the intentionally truncated password example in the
README. The packed manifest has no `preinstall`, `install`, `postinstall`, or
`prepare` script. Runtime dependencies are externally resolved, not bundled.

The package is ESM (`"type": "module"`), requires Node `>=18.0.0`, and exports
`./dist/index.js` with declarations at `./dist/index.d.ts`. The package
`files` whitelist is `dist`, `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`, and
`README.md`. License is `MIT OR Apache-2.0`. Repository metadata points to
`git+https://github.com/canblmz1/prefix-safe-json.git`.

## Source-to-dist mapping

`pnpm run build` runs `tsc -p tsconfig.build.json`. TypeScript targets ES2022,
uses Node16 module resolution, and emits ESM JavaScript, declarations, and both
map types from `src/**/*.ts` into `dist/`. Every one of the 34 JavaScript maps
names exactly one corresponding `src/**/*.ts` input; no map embeds
`sourcesContent`. This is a one-source-file-to-one-emitted-module build, not a
bundle. Consumers must retrieve the tagged source to inspect source text.

## Provenance mapping — 0.4.1

The official npm attestation endpoint is:

```text
https://registry.npmjs.org/-/npm/v1/attestations/prefix-safe-json@0.4.1
```

The SLSA v1 statement records:

- subject `pkg:npm/prefix-safe-json@0.4.1` with the SHA-512 above;
- repository `https://github.com/canblmz1/prefix-safe-json`;
- workflow `.github/workflows/publish.yml` at `refs/heads/main`;
- source commit `2d2dc5ae5d83d8db73d485ade2872939459bdc09`;
- GitHub-hosted Actions builder;
- invocation `https://github.com/canblmz1/prefix-safe-json/actions/runs/32855671942/attempts/1`.

`npm@11.5.1 audit signatures` on a clean installed dependency graph reported
six verified registry signatures and one verified attestation.

Provenance binds an artifact digest to a repository, workflow, and commit. It
does **not** prove the source is correct, the workflow is uncompromised, the
dependencies are safe, or the runtime behavior matches a reviewer's policy.
The independent rebuild and source audit remain necessary.

## CI and release controls

`scripts/verify-package-policy.mjs` is run against the actual packed artifact
in PR CI and again in the publish job. It rejects unexpected/hidden paths,
symlinks, NUL-bearing binary `dist` files, consumer install lifecycle scripts,
and unreviewed changes to runtime dependencies, package entrypoints, or the
files whitelist.

The publish job now uses the pinned `npm@11.5.1` to create one tarball, prints
its SHA-256, runs the package policy and clean-room installed-tarball smoke
against that file, rechecks the SHA-256 immediately before publication, and
passes that same path to `npm publish`. It no longer tests one archive and
asks `npm publish` to repack the directory later.

The online published-release verifier is deliberately not a normal PR gate:
an already-published registry artifact corresponds to an older tag, while PR
source is intentionally different, and registry/network availability should
not decide unrelated PRs. It is a command-driven release/audit check.

## Scope and history

`0.4.1` and `0.4.2` have both been independently rebuilt for this record via
`npm run verify:published-release` — `0.4.1` through the `gitHead` policy,
`0.4.2` through the provenance-fallback policy above. Earlier releases have
tags and registry metadata but are **not** claimed reproducible here.
Registry dependency ranges can resolve differently over time; see
[`RUNTIME_DEPENDENCIES.md`](RUNTIME_DEPENDENCIES.md).
