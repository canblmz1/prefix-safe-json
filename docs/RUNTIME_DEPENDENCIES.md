# Runtime dependencies

This is an evidence snapshot, not a claim that semver ranges resolve forever.
The published `0.4.1` tarball declares one direct production dependency:

```text
prefix-safe-json@0.4.1
└── ajv@^8.20.0
    ├── fast-deep-equal@^3.1.3
    ├── fast-uri@^3.0.1
    ├── json-schema-traverse@^1.0.0
    └── require-from-string@^2.0.2
```

There are no production peer dependencies or optional dependencies. No
dependency code is bundled into `prefix-safe-json`; a consumer's package
manager resolves this graph externally.

## Exact observed graphs

The frozen `pnpm-lock.yaml` at release commit
`2d2dc5ae5d83d8db73d485ade2872939459bdc09` resolves:

```text
prefix-safe-json@0.4.1
└── ajv@8.20.0
    ├── fast-deep-equal@3.1.3
    ├── fast-uri@3.1.5
    ├── json-schema-traverse@1.0.0
    └── require-from-string@2.0.2
```

A fresh npm consumer install on 2026-08-27 resolved the same graph except
`fast-uri@3.1.6`. Application lockfiles, overrides, registry state, and the
semver ranges above determine the graph that actually executes for a given
consumer. Audit that lockfile rather than substituting this snapshot.

## Package-by-package review

| Package | Release-lock version | License | Node engine | Why present / import behavior | Consumer install lifecycle |
| --- | --- | --- | --- | --- | --- |
| `ajv` | `8.20.0` | MIT | not declared | Direct dependency used in `src/coordinator/coordinator.ts` to compile optional per-tool JSON Schema validators. It is statically imported when the package entrypoint loads; an `Ajv` instance is created only when schemas are supplied. | no `preinstall`, `install`, `postinstall`, or `prepare`; published manifest has `prepublish`, which is not observed during registry dependency installation |
| `fast-deep-equal` | `3.1.3` | MIT | not declared | Ajv helper used by generated/schema-validation code; may execute as Ajv loads or validates. | no consumer install lifecycle scripts; published manifest has `prepublish` |
| `fast-uri` | `3.1.5` | BSD-3-Clause | not declared | Ajv URI parsing/resolution helper; may execute while schemas compile or validate. | no consumer install lifecycle scripts |
| `json-schema-traverse` | `1.0.0` | MIT | not declared | Ajv schema traversal helper; executes during schema compilation when needed. | no consumer install lifecycle scripts |
| `require-from-string` | `2.0.2` | MIT | `>=0.10.0` | Ajv code-generation helper for loading generated validation modules; can execute when Ajv uses that path. | no consumer install lifecycle scripts |

Import/execution statements above are conservative: static CommonJS loading
and Ajv internals may evaluate helpers before a schema is compiled. They are
not claims that every helper runs for every API call.

The package does not depend on `ai` at runtime. Exact AI SDK versions
`5.0.244`, `6.0.264`, and `7.0.77` are aliased dev dependencies used for
compatibility/lifecycle proofs only.

## Reproduce the graph

Release-lock snapshot:

```console
git switch --detach v0.4.1
corepack pnpm install --frozen-lockfile
corepack pnpm list --prod --depth 99
corepack pnpm licenses list --prod
```

Current consumer resolution and install-time observation:

```console
mkdir prefix-safe-json-consumer-audit
cd prefix-safe-json-consumer-audit
npm init -y
npm install --foreground-scripts --loglevel verbose prefix-safe-json@0.4.1
npm ls --all prefix-safe-json ajv fast-deep-equal fast-uri json-schema-traverse require-from-string
npm audit --omit=dev
npx --yes npm@11.5.1 audit signatures
```

The package-policy CI gate rejects additions to direct runtime, optional,
peer, bundled, binary, or install-lifecycle surfaces until the policy and
review are deliberately updated.
