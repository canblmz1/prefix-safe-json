# Release integrity

This document records independently rechecked release evidence. It is not a
promise about future artifacts. Re-run the commands in
[`MAINTAINER_AUDIT.md`](MAINTAINER_AUDIT.md) before making a trust decision.

## Verified baseline (2026-08-27)

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

## Reproduction result

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

## Provenance mapping

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

Only `0.4.1` has been independently rebuilt for this record. Earlier releases
have tags and registry metadata but are **not** claimed reproducible here.
Registry dependency ranges can resolve differently over time; see
[`RUNTIME_DEPENDENCIES.md`](RUNTIME_DEPENDENCIES.md).
