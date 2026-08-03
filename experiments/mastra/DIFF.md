# ISOLATED GIT DIFF — Mastra

```diff
--- a/packages/core/src/tools/index.ts
+++ b/packages/core/src/tools/index.ts
@@ -1,4 +1,4 @@
-import { jsonrepair } from 'jsonrepair';
+import { createParser } from '@internal/incremental-tool-json';
 import { z } from 'zod';

 export async function executeTool(rawInput: string, schema: z.ZodSchema) {
-  const repaired = jsonrepair(rawInput);
-  const parsed = JSON.parse(repaired);
+  const parser = createParser({
+    repairs: {
+      rawControlCharacters: "escape",
+      trailingData: "isolate",
+      closeContainersAtFinish: "safe-only",
+    },
+  });
+  parser.push(rawInput);
+  const res = parser.finish({ reason: "complete" });
+  if (!res.executable) {
+    throw new Error("Mastra tool arguments non-executable or incomplete");
+  }
+  const parsed = res.stableValue;
   return schema.parse(parsed);
 }
```
