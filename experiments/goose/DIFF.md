# ISOLATED GIT DIFF — Block Goose

```diff
--- a/ui/src/client/tool-stream.ts
+++ b/ui/src/client/tool-stream.ts
@@ -1,4 +1,4 @@
+import { createParser } from '@internal/incremental-tool-json';

 export class GooseToolStreamHandler {
-  private buffer = "";
+  private parser = createParser();

   onDelta(delta: string) {
-    this.buffer += delta;
-    try {
-      this.parsed = JSON.parse(this.buffer);
-    } catch {}
+    this.parser.push(delta);
+    const snap = this.parser.snapshot();
+    if (snap.rootComplete) {
+      this.parsed = snap.stableValue;
+    }
   }
 }
```
