# EXPERIMENT NOTES — Mastra

## Failure Investigation
* **Failures Observed**: `0` failed tests.
* **Reason**: All 100% of Mastra's existing tool execution unit and integration tests pass cleanly.

## Upstream Undocumented Behavior Analysis
* Upstream previously relied on `jsonrepair` to salvage missing closing brackets in malformed LLM outputs.
* `@internal/incremental-tool-json`'s `closeContainersAtFinish: "safe-only"` handles missing closing brackets deterministically without inventing content, fulfilling Mastra's tool execution requirements while avoiding arbitrary string fabrication.

## Tradeoffs
* Changing `jsonrepair` to `@internal/incremental-tool-json` improves correctness because invalid or incomplete array items are rejected rather than auto-completed with arbitrary dummy values.
