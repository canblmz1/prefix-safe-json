# Trial follow-up

The `Adoption follow-up` workflow reads the public trial threads listed in
[the watch configuration](../.github/adoption-watch.json) and this repository's
integration reports every four hours (`23 */4 * * *`, UTC). It can also be run
manually from Actions or with:

```sh
gh workflow run adoption-watch.yml --repo canblmz1/prefix-safe-json --ref main
```

Each run writes an Actions summary and a downloadable `adoption-follow-up-*`
artifact containing `report.json` and `summary.md`, retained for 30 days. It
uses only built-in Node modules and read-only GitHub permissions. It installs
no npm packages, executes no third-party project code, changes no threads and
sends no invitations. This is ongoing evidence collection; coding, technical
follow-up and confirmation of independent project use require maintainer work.

Issue comments, discussion comments and nested replies are paginated. A
reviewed comment edited to different text is flagged again. API failures are
reported as failures with a nonzero exit code, not as an absence of replies.
Integration forms receive the `integration` label; older unlabelled forms
are also recognized by their title or form heading.

The confirmed count comes **only** from the configuration's manually maintained
`goal.confirmedDevelopers`. Add a distinct developer login, project and public
evidence URL only after reviewing a confirmed independent own-project run.
The maintainer's own runs are rejected. Fixture runs, downloads, native-only
fixes and promising replies never increase the count automatically. Historical
verification remains separate from newly acquired users.

After reviewing a reply, add its URL, exact `bodySha256` from the report and
classification to that thread's `reviewedResponses`. Record a decline as a
decline; do not re-invite a developer who declined. Integration-report bodies
and comments use `reviewedIntegrationReports` in the same way. Updating the
review hash acknowledges evidence without declaring adoption.

For local operation, set `GH_TOKEN` through your authenticated environment,
then run `node scripts/watch-adoption.mjs`. Credentials are never stored in
reports. Contract checks run with `node --test test/scripts/adoption-watch.test.mjs`.

GitHub's scheduler can delay or drop runs under load and disables scheduled
workflows after 60 days of public-repository inactivity. Check the actual
Actions run history; manual dispatch is available. See
[GitHub's schedule event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
