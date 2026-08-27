# Maintainer audit guide

This guide assumes the publisher is untrusted. Run it in a disposable clone
and make your own accept/reject decision from the outputs.

Prerequisites: Git, Node 22 or 24 for repository tooling, Corepack, npm, and a
`tar` CLI. The published runtime supports Node `>=18.0.0`; the newer Node
version here is for the pinned development toolchain.

## 1. Verify repository and tag

```console
git clone https://github.com/canblmz1/prefix-safe-json.git
cd prefix-safe-json
git fetch origin --tags
git remote get-url origin
git rev-parse origin/main
git rev-parse v0.4.2^{commit}
git show --show-signature --no-patch v0.4.2^{commit}
```

For `0.4.2`, the tag must resolve to
`8443e5f20d21d7b85e7568e97205645e92e0dfd4`.

## 2. Verify npm metadata

```console
npm view prefix-safe-json@0.4.2 version gitHead engines license type files dependencies optionalDependencies peerDependencies scripts repository dist --json
npm view prefix-safe-json dist-tags --json
```

Compare the output with [`RELEASE_INTEGRITY.md`](RELEASE_INTEGRITY.md). Do not
infer npm contents from the Git checkout.

## 3. Download the exact registry tarball

This portable Node command reads the official metadata and writes the URL it
actually downloaded:

```console
node -e "fetch('https://registry.npmjs.org/prefix-safe-json/0.4.2').then(r=>r.json()).then(async m=>{const r=await fetch(m.dist.tarball);if(!r.ok)throw Error(String(r.status));require('node:fs').writeFileSync('prefix-safe-json-0.4.2.tgz',Buffer.from(await r.arrayBuffer()));console.log(m.dist.tarball)})"
```

## 4. Verify tarball integrity

```console
node -e "const fs=require('node:fs'),c=require('node:crypto'),b=fs.readFileSync('prefix-safe-json-0.4.2.tgz');for(const a of ['sha1','sha256','sha512'])console.log(a,c.createHash(a).update(b).digest(a==='sha512'?'base64':'hex'))"
```

Expected SHA-1, SHA-256, and SRI SHA-512 are recorded in
[`RELEASE_INTEGRITY.md`](RELEASE_INTEGRITY.md). Also compare against live
`dist.shasum` and `dist.integrity`, not only this repository document.

## 5. Inspect published files

```console
tar -tzf prefix-safe-json-0.4.2.tgz
tar -tvzf prefix-safe-json-0.4.2.tgz
mkdir npm-unpacked
tar -xzf prefix-safe-json-0.4.2.tgz -C npm-unpacked
npm run verify:package-policy -- prefix-safe-json-0.4.2.tgz
```

Review every path and mode. The policy command fails on hidden/unexpected
paths, symlinks, non-text `dist` content, unreviewed runtime dependency
changes, binaries, entrypoint changes, or install lifecycle scripts.

## 6. Confirm no install scripts

```console
node -e "const p=require('./npm-unpacked/package/package.json');for(const n of ['preinstall','install','postinstall','prepare'])console.log(n,p.scripts?.[n]??'<absent>')"
```

Repeat for the resolved production dependency manifests, then install in a
disposable consumer with visible lifecycle output:

```console
mkdir consumer-audit
cd consumer-audit
npm init -y
npm install --foreground-scripts --loglevel verbose ../prefix-safe-json-0.4.2.tgz
```

## 7. Compare npm bytes to a source build

From the repository root:

```console
npm run verify:published-release -- 0.4.2
```

Read the printed `result.json` and both per-file SHA-256 manifests. Require
`packageContentIdentical: true`; treat every manifest difference as a stop.
`tarballByteIdentical` is separate because container metadata/tool versions
can differ even when content matches.

For `0.4.2` specifically, npm's registry metadata has no `gitHead` — `0.4.2`
was published by `npm publish <tarball-path>` against an already-packed
artifact (see [`RELEASE_INTEGRITY.md`](RELEASE_INTEGRITY.md)), which does not
populate that field. The verifier establishes the release commit through
verified provenance instead in that case (`result.json`'s
`sourceIdentityMethod` reads `"provenance"` rather than `"npm-gitHead"`) —
requiring the provenance statement's repository, workflow, and subject
SHA-512 to check out, and its source commit to match the Git tag, before
using it. It fails closed if `gitHead` is absent and provenance is missing,
malformed, ambiguous, or disagrees; see `determineReleaseCommit` and
`decodeProvenance` in `scripts/verify-published-release.mjs` for the exact
policy, and their tests in
`test/unit/verify-published-release-identity.test.ts`.

## 8. Inspect runtime dependencies

Follow [`RUNTIME_DEPENDENCIES.md`](RUNTIME_DEPENDENCIES.md), then inspect your
own application lockfile:

```console
npm ls --all prefix-safe-json ajv fast-deep-equal fast-uri json-schema-traverse require-from-string
npm audit --omit=dev
```

The published semver ranges are not a frozen consumer graph.

## 9. Verify provenance

```console
npx --yes npm@11.19.0 audit signatures --json --include-attestations
```

Confirm the printed `verified` array has exactly one entry whose `name` and
`version` match `prefix-safe-json@0.4.2` exactly - another dependency having
a verified attestation does not count, and neither does a name match at a
different version - and that entry carries exactly one attestation bundle.
Decode that bundle's DSSE payload and confirm its subject SHA-512, source
commit, repository, workflow path, and invocation.

This is not two independent checks layered together: `npm audit signatures`
performs npm's own Sigstore-backed signature verification, and
`--include-attestations` is what makes it return the *exact verified bundle*
per package rather than only an aggregate pass/fail. Decoding JSON on its
own is not signature validation, decoding a *separately fetched* copy of the
attestation (e.g. from `https://registry.npmjs.org/-/npm/v1/attestations/...`)
does not prove it is the same bytes npm verified, and neither does a global
"N packages have a verified attestation" count, which a transitive
dependency could equally satisfy without saying anything about
`prefix-safe-json` itself.

`npm run verify:published-release` performs exactly the sequence above, in
order, for any release whose provenance it uses at all: isolated install of
the exact version, integrity cross-check against the already-downloaded
tarball, `npm audit signatures --json --include-attestations`, exact
name+version match against `verified[]`, exactly-one-bundle check, and only
then content decoding of that specific bundle. It never fetches the
registry's attestations HTTP endpoint for this decision. Content that
matches expectations perfectly is still rejected if any step before it did
not run or did not succeed.

## 10. Audit execution-critical source

Start with the two authority files, then follow the conservative dependency
closure in [`EXECUTION_AUDIT_SURFACE.md`](EXECUTION_AUDIT_SURFACE.md). In
particular, verify that `decideExecution()` has one positive branch and that
`takeDecision()` exposes it only after `finish()` and only once.

## 11. Run package tests

```console
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run lint --max-warnings=0
corepack pnpm run validate-corpus
corepack pnpm run test
corepack pnpm run test:coverage
corepack pnpm run build
corepack pnpm run example:anthropic
corepack pnpm run example:ai-sdk
corepack pnpm run example:ai-sdk-guard
corepack pnpm run example:ai-sdk-lifecycle-proof
corepack pnpm run pack:check
```

The release workflow additionally runs mutation testing and a timed fuzz gate.

## 12. Verify the target SDK independently

The repository tests exact dev pins, not every release in an AI SDK major.
Check `package.json`, `pnpm-lock.yaml`, and
[`COMPATIBILITY.md`](COMPATIBILITY.md), then run the lifecycle proof against
the exact SDK version you plan to deploy. Do not generalize a major-version
claim beyond tested pins.

## 13. Decide

Accept the dependency only if the artifact hashes, source rebuild, provenance,
resolved dependency graph, execution-critical source, and your own policy all
pass. Provenance does not replace code review, authorization, sandboxing,
idempotency, or application-level controls.
