# INTEGRATION DIFF SUMMARY

## 1. Mastra Integration Diff (`packages/core/src/tools/index.ts`)

```diff
- import { jsonrepair } from 'jsonrepair';
+ import { createParser } from '@internal/incremental-tool-json';

  export async function executeTool(rawInput: string) {
-   const repaired = jsonrepair(rawInput);
-   const parsed = JSON.parse(repaired);
+   const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
+   parser.push(rawInput);
+   const res = parser.finish({ reason: "complete" });
+   if (!res.executable) throw new Error("Tool arguments non-executable");
+   const parsed = res.stableValue;
    return inputSchema.parse(parsed);
  }
```

## 2. Block Goose Integration Diff (`ui/src/client/tool-stream.ts`)

```diff
+ import { createParser } from '@internal/incremental-tool-json';

  class ToolStreamHandler {
+   private parser = createParser();

    onDelta(delta: string) {
-     this.buffer += delta;
-     try {
-       this.parsed = JSON.parse(this.buffer);
-     } catch {}
+     this.parser.push(delta);
+     const snap = this.parser.snapshot();
+     if (snap.rootComplete) {
+       this.parsed = snap.stableValue;
+     }
    }
  }
```

## 3. Vercel AI SDK Integration Diff (`packages/ui-utils/src/parse-partial-json.ts`)

```diff
+ import { createParser } from '@internal/incremental-tool-json';

  export function parsePartialJson(jsonText: string) {
-   try {
-     return JSON.parse(jsonText);
-   } catch {
-     // regex repair...
-   }
+   const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
+   parser.push(jsonText);
+   const res = parser.finish({ reason: "complete" });
+   return res.stableValue;
  }
```
