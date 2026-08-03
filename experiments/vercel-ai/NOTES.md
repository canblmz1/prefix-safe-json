# EXPERIMENT NOTES — Vercel AI SDK

## Failure Investigation
* **Failures Observed**: `0` failed tests in `ui-utils` and `provider-utils`.

## Upstream Undocumented Behavior Analysis
* Upstream used `fixJson()` regex string manipulation. Replacing it with `@internal/incremental-tool-json` passes 100% of existing `parsePartialJson` unit tests.

## Tradeoffs
* Standard `JSON.parse` overwrites duplicate keys (last key wins). `@internal/incremental-tool-json` uses first-wins duplicate key rejection with `E_DUPLICATE_KEY` diagnostic.
