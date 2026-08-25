// Runs the exact pinned AI SDK lifecycle proofs sequentially.
await import("./ai-sdk-v5-safe-boundary.mjs");
await import("./ai-sdk-v6-safe-boundary.mjs");
await import("./ai-sdk-v7-safe-boundary.mjs");

console.log("PASS exact AI SDK lifecycle proof: 5.0.244 / 6.0.264 / 7.0.77");
