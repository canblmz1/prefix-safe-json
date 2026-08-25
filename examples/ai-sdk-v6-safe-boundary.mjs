// Exact ai@6 lifecycle proof using its official MockLanguageModelV3 boundary.

import { jsonSchema, streamText } from "ai-v6";
import { MockLanguageModelV3 } from "ai-v6/test";
import { runLifecycleProof } from "./ai-sdk-lifecycle-proof.shared.mjs";

function createModel(parts) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
}

export default await runLifecycleProof({
  exactVersion: "ai@6.0.264",
  approvalTruth: "lock removes callbacks and needsApproval backstops execute",
  streamText,
  jsonSchema,
  createModel,
  makeFinishReason: (reason) => ({ unified: reason, raw: reason }),
});
