# EXPERIMENT NOTES — Block Goose

## Failure Investigation
* **Failures Observed**: `0` failed tests.
* **Reason**: Replaces internal string try/catch buffer without breaking consumer expectations.

## Upstream Undocumented Behavior Analysis
* Upstream relied on try/catch catching `SyntaxError` on every incomplete chunk. Replaced by `snap.rootComplete` checking without exceptions.

## Tradeoffs
* Eliminates V8 exception overhead entirely.
