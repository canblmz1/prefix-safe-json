// ---------------------------------------------------------------------------
// Chunk Partition Generator
// ---------------------------------------------------------------------------
// Generates various chunk partition strategies for testing chunk invariance.
// ---------------------------------------------------------------------------

/**
 * Generate multiple ways to split an input string into chunks.
 * Returns an array of partitions, where each partition is an array of strings.
 */
export function generatePartitions(input: string): string[][] {
  const partitions: string[][] = [];

  // 1. Single chunk
  partitions.push([input]);

  // 2. Character-per-chunk
  partitions.push([...input]);

  // 3. Byte-per-chunk (UTF-8)
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(input);
  const byteChunks: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    byteChunks.push(decoder.decode(bytes.slice(i, i + 1)));
  }
  // For byte-per-chunk, return as Uint8Array partitions via a separate function
  partitions.push(byteChunks);

  // 4. Two halves
  if (input.length >= 2) {
    const mid = Math.floor(input.length / 2);
    partitions.push([input.slice(0, mid), input.slice(mid)]);
  }

  // 5. Adversarial: split at every structural character
  const structuralSplits = generateStructuralSplits(input);
  if (structuralSplits.length > 1) {
    partitions.push(structuralSplits);
  }

  return partitions;
}

/**
 * Generate byte-level partitions as Uint8Array arrays.
 */
export function generateBytePartitions(input: string): Uint8Array[][] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  const partitions: Uint8Array[][] = [];

  // Single chunk
  partitions.push([bytes]);

  // Byte-per-chunk
  const byteChunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i++) {
    byteChunks.push(bytes.slice(i, i + 1));
  }
  partitions.push(byteChunks);

  // Two halves
  if (bytes.length >= 2) {
    const mid = Math.floor(bytes.length / 2);
    partitions.push([bytes.slice(0, mid), bytes.slice(mid)]);
  }

  // Every 2 bytes
  if (bytes.length > 4) {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      chunks.push(bytes.slice(i, Math.min(i + 2, bytes.length)));
    }
    partitions.push(chunks);
  }

  return partitions;
}

/**
 * Split input at structural JSON characters.
 */
function generateStructuralSplits(input: string): string[] {
  const structural = new Set(["{", "}", "[", "]", ":", ",", '"']);
  const chunks: string[] = [];
  let current = "";

  for (const ch of input) {
    if (structural.has(ch) && current.length > 0) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
