# Publish psj-ai-sdk

The companion package has a separate npm identity from `prefix-safe-json`.
Its runtime and peer dependencies do not change the core package's release
or dependency policy. The 0.3.1 candidate contains the same runtime as the
0.3.0 GitHub preview; it enables npm publication and adds repository metadata.

Run `publish-ai-sdk.yml` on `main` with the exact version in this directory's
`package.json`. The workflow builds one tarball, installs and checks that
tarball against all three supported SDK/provider pairs, compiles strict
consumers, and checks native result continuation. It uploads the tested
tarball and its checksum before publication.

The publish job uses the existing `npm-publish` environment and its deployment
review. It verifies the artifact checksum again and publishes those exact
bytes with provenance. It does not rebuild or repack them. Existing registry
versions fail the workflow rather than being overwritten. A failed publish
does not create a release tag.

Use either of these npm authentication methods:

- Store a valid npm publishing credential as the repository or `npm-publish`
  environment Actions secret `NPM_TOKEN`. The workflow provides it only to
  the publishing step as `NODE_AUTH_TOKEN`; never paste it into a workflow,
  issue, log or PR. The credential must permit publishing this package.
- Configure an npm trusted publisher for **psj-ai-sdk**, repository
  `canblmz1/prefix-safe-json`, workflow filename `publish-ai-sdk.yml`,
  environment `npm-publish`. The workflow supports native npm OIDC when no
  token is supplied. A trusted publisher for the core package does not
  configure the companion package.

A GitHub account token or automatic `GITHUB_TOKEN` is not an npm registry
credential. GitHub's secrets API lists names and metadata, not stored values;
use the npm secret inside Actions instead of trying to export it.

After a successful publish, verify `npm view psj-ai-sdk@<version>` and perform
a fresh install by package name before changing the root quick start or
marking a release available. Keep the GitHub 0.3.0 fallback until then.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).
