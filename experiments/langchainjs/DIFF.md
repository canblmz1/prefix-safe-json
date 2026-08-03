# ISOLATED GIT DIFF — LangChain.js

```diff
--- /dev/null
+++ b/packages/core/src/output_parsers/incremental_tools.ts
@@ -0,0 +1,64 @@
+import { BaseOutputParser } from "./base.js";
+import { createParser } from "@internal/incremental-tool-json";
+
+export class IncrementalToolCallOutputParser extends BaseOutputParser {
+  lc_namespace = ["langchain", "schema", "output_parser"];
+  private parser = createParser();

+  async parse(text: string) {
+    this.parser.push(text);
+    const res = this.parser.finish({ reason: "complete" });
+    return res.stableValue;
+  }

+  pushChunk(chunk: string) {
+    this.parser.push(chunk);
+    return this.parser.snapshot();
+  }
+}
```
