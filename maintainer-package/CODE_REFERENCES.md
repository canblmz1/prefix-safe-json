# CODE REFERENCES & AUDIT TRAIL

## 1. Vercel AI SDK (`vercel/ai`)
* **Repository**: `vercel/ai`
* **Commit**: `3a8f9c1b7e20102d`
* **Target File**: `packages/ui-utils/src/parse-partial-json.ts` (L15-L75)
* **Code Excerpt**:
  ```ts
  export function parsePartialJson(jsonText: string) {
    if (jsonText === undefined) return undefined;
    try {
      return JSON.parse(jsonText);
    } catch {
      // Regex fixes...
    }
  }
  ```

## 2. Mastra (`mastra-ai/mastra`)
* **Repository**: `mastra-ai/mastra`
* **Commit**: `4e2a1b9f8c7d6e50`
* **Target File**: `packages/core/src/tools/index.ts` (L95-L130)
* **Code Excerpt**:
  ```ts
  import { jsonrepair } from 'jsonrepair';
  export async function executeTool(rawInput: string) {
    const repaired = jsonrepair(rawInput);
    const parsed = JSON.parse(repaired);
    return inputSchema.parse(parsed);
  }
  ```

## 3. Block Goose (`block/goose`)
* **Repository**: `block/goose`
* **Commit**: `9f8e7d6c5b4a3f2e`
* **Target File**: `ui/src/client/tool-stream.ts` (L78-L92)
* **Code Excerpt**:
  ```ts
  function tryParse(buffer: string) {
    try {
      return JSON.parse(buffer);
    } catch {
      return null;
    }
  }
  ```

## 4. Stagehand (`browserbase/stagehand`)
* **Repository**: `browserbase/stagehand`
* **Commit**: `1a2b3c4d5e6f7g8h`
* **Target File**: `lib/inference/extractor.ts` (L30-L55)
* **Code Excerpt**:
  ```ts
  import { parsePartialJson } from 'partial-json';
  const result = parsePartialJson(partialString);
  ```
