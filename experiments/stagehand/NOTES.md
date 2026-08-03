# EXPERIMENT NOTES — Stagehand

## Failure Investigation
* **Failures Observed**: `0` failed tests.

## Upstream Undocumented Behavior Analysis
* Upstream relied on `partial-json` returning `undefined` for unparseable strings. `@internal/incremental-tool-json` returns `{}` for empty stable values.

## Tradeoffs
* Eliminates `partial-json` package dependency entirely.
