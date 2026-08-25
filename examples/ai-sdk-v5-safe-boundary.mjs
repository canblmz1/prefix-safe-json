// Exact ai@5 lifecycle proof. This major has no needsApproval mechanism.
// Its published LanguageModelV2 provider interface is used directly because
// ai-v5/test imports an otherwise-unused msw package at module load time.

import { jsonSchema, streamText } from "ai-v5";
import { runLifecycleProof } from "./ai-sdk-lifecycle-proof.shared.mjs";

function createModel(parts) {
  return {
    specificationVersion: "v2",
    provider: "lifecycle-proof",
    modelId: "ai-v5-proof",
    supportedUrls: {},
    doGenerate() {
      throw new Error("doGenerate() must not run in a streamText() proof");
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}

export default await runLifecycleProof({
  exactVersion: "ai@5.0.244",
  approvalTruth: "no needsApproval mechanism; lock safety comes from callback removal",
  streamText,
  jsonSchema,
  createModel,
  makeFinishReason: (reason) => reason,
});
