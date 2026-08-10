# Release Checklist

When preparing a release for `prefix-safe-json`, ensure the following steps are taken:

## 1. Quality Assurance
- [ ] Ensure all CI tests pass (`npm test`, `npm run typecheck`, `npm run lint`).
- [ ] Run benchmark suite (`npm run bench`) and compare against regressions.
- [ ] Run `npm run test:fuzz` for 10+ minutes.
- [ ] Run mutation testing (`npm run test:mutate`) and ensure score > 85%.
- [ ] Verify Code Coverage (`npm run test:coverage`) >= 95%.

## 2. API Stability
- [ ] Check exported symbols in `src/index.ts` for accidental exposure of internal types.
- [ ] Verify correct use of `@public`, `@internal`, and `@experimental` tags.

## 3. Version Bumping
- [ ] Update `package.json` version.
- [ ] Update `CHANGELOG.md` with features, fixes, and breaking changes.

## 4. Release execution
- [ ] Generate build: `npm run build`.
- [ ] Validate package output: `npm run pack:check` (ensure only `/dist`, `package.json`, and `README.md`/`LICENSE*` are packed).
- [ ] Tag the release on git: `git tag v0.x.y` and `git push --tags`.
- [ ] Publish to npm via CI or manually `npm publish --access public`.
