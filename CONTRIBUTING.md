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

## Test Corpus

When adding new test fixtures, follow the schema in `corpus/schema/fixture.schema.json` and document the fixture in the appropriate category directory.

Run `pnpm validate-corpus` to verify fixture validity.

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
