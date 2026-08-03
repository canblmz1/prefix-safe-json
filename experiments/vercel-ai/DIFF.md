# ISOLATED GIT DIFF — Vercel AI SDK

```diff
--- a/packages/ui-utils/src/parse-partial-json.ts
+++ b/packages/ui-utils/src/parse-partial-json.ts
-import { fixJson } from './fix-json';
+import { createParser } from '@internal/incremental-tool-json';

 export function parsePartialJson(jsonText: string) {
   if (jsonText === undefined) return undefined;
-  try {
-    return JSON.parse(jsonText);
-  } catch {
-    return JSON.parse(fixJson(jsonText));
-  }
+  const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
+  parser.push(jsonText);
+  const snap = parser.snapshot();
+  return snap.stableValue;
 }
```
