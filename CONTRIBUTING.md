# Contributing

Thank you for your interest in contributing!

## Development Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

## Project Principles

- **Dependency discipline**: Keep the core parser small and deterministic. New runtime dependencies need a clear correctness or safety justification; JSON Schema validation currently uses AJV.
- **No dynamic code execution**: Never use `eval`, `Function`, or similar constructs.
- **Incremental processing**: Never re-parse previous input on new chunks.
- **Amortized O(total input)**: Parser processing must be proportional to total input size.
- **Honest diagnostics**: Never fabricate or guess missing data.
- **Execution integrity**: A syntactically repairable or schema-shaped value must not be treated as executable unless the stream state confirms it is complete.

## Current Development Posture

Runtime or public-API expansion currently requires at least one of:

- a verified security or correctness defect;
- a real adopter compatibility blocker;
- a provider or SDK compatibility regression; or
- an externally demonstrated execution-integrity gap.

Nice-to-have features alone should not drive releases at this stage. This is a
prioritization policy, not a freeze: focused fixes and evidence-backed
compatibility work remain welcome.

## Test Corpus

When adding new test fixtures, follow the schema in `corpus/schema/fixture.schema.json` and document the fixture in the appropriate category directory.

Run `pnpm validate-corpus` to verify fixture validity.

## Conformance fixtures

`conformance/fixtures/` is a separate, public, provider-neutral corpus of
execution-authority outcomes (not raw parser edge cases - see
`docs/CONFORMANCE.md`). Add a new fixture matching
`conformance/schema/fixture.schema.json`, set `provenance.classification`
honestly, and run `pnpm test test/conformance/` - the suite loads every
fixture in the directory automatically.

## Adding a provider adapter

New provider support needs a `ProviderStreamAdapter` implementation (see
existing adapters in `src/providers/`), a set of `corpus/provider-envelopes/`
fixtures covering that provider's own streaming shape, and ideally a
`conformance/fixtures/` case if it exercises a genuinely new
execution-authority scenario the existing corpus doesn't cover. Open an
issue describing the provider and its streaming shape before submitting a
PR, per "Current Development Posture" above.

## Commit Messages

Use conventional commit format:

```
feat: add support for X
fix: handle edge case Y
test: add fixtures for Z
docs: update architecture notes
```

## Code Style

- TypeScript strict mode is enforced
- ESLint rules are configured in `eslint.config.js`
- All exported types must have JSDoc documentation
