# EXPERIMENT NOTES — LangChain.js

## Failure Investigation
* **Failures Observed**: `0` failed tests.

## Upstream Undocumented Behavior Analysis
* Upstream core delays parsing tool arguments until stream completion. Adding `IncrementalToolCallOutputParser` enables incremental streaming without modifying default behavior.

## Tradeoffs
* Zero breaking changes; 100% additive module.
