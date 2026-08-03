# ISOLATED GIT DIFF — Stagehand

```diff
--- a/lib/inference/extractor.ts
+++ b/lib/inference/extractor.ts
-import { parsePartialJson } from 'partial-json';
+import { createParser } from '@internal/incremental-tool-json';

 export function extractActionParameters(partialString: string) {
-  return parsePartialJson(partialString) ?? {};
+  const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
+  parser.push(partialString);
+  const snap = parser.snapshot();
+  return snap.stableValue ?? {};
 }
```
