import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORPUS_DIR = path.resolve(__dirname, "../corpus/fuzz");

if (!fs.existsSync(CORPUS_DIR)) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
}

function writeFixture(id: string, fixture: unknown) {
  const filePath = path.join(CORPUS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf8");
}

let counter = 1;

function generateStringMutations() {
  // Create 10 variants of strings with random control characters
  for (let i = 0; i < 10; i++) {
    const id = `fuzz-string-${String(counter++).padStart(3, "0")}`;
    const controlChar = String.fromCharCode(Math.floor(Math.random() * 32));
    const mutated = `{"text":"hello${controlChar}world"}`;
    
    writeFixture(id, {
      version: 1,
      id,
      title: `Fuzz String ${i}`,
      category: "fuzz",
      input: {
        encoding: "utf8-text",
        data: mutated,
      },
      stream: {
        endReason: "complete",
        chunkStrategies: ["single", "byte-per-chunk"],
      },
      expected: {
        syntax: "invalid",
        outcome: "invalid",
        executable: false,
        diagnostics: [{ code: "W_RAW_CONTROL_CHARACTER", severity: "error", recoverable: false }],
        repairs: [],
        events: []
      },
      provenance: { source: "synthetic" }
    });
  }
}

function generateDepthMutations() {
  // Create 10 deeply nested structures
  for (let i = 0; i < 10; i++) {
    const id = `fuzz-depth-${String(counter++).padStart(3, "0")}`;
    const depth = 50 + Math.floor(Math.random() * 50);
    
    let nested = "{}";
    for (let d = 0; d < depth; d++) {
      nested = `{"k":${nested}}`;
    }
    
    writeFixture(id, {
      version: 1,
      id,
      title: `Fuzz Depth ${depth}`,
      category: "fuzz",
      input: {
        encoding: "utf8-text",
        data: nested,
      },
      stream: {
        endReason: "complete",
        chunkStrategies: ["single"],
      },
      expected: {
        syntax: "root_complete",
        outcome: "valid",
        executable: true,
        diagnostics: [],
        repairs: [],
        events: [] // Omitted for brevity in fuzz fixtures, test runner shouldn't require full exact event array for fuzz if not specified
      },
      provenance: { source: "synthetic" }
    });
  }
}

function generateTruncationMutations() {
  // Create 20 truncated variations of a large JSON
  const largeJson = JSON.stringify({
    a: [1, 2, 3, 4, 5],
    b: { c: "hello", d: "world", e: { f: true, g: null, h: 42.5 } },
    i: "end"
  });
  
  for (let i = 0; i < 20; i++) {
    const id = `fuzz-trunc-${String(counter++).padStart(3, "0")}`;
    const sliceLen = Math.floor(Math.random() * largeJson.length);
    const sliced = largeJson.slice(0, sliceLen);
    
    writeFixture(id, {
      version: 1,
      id,
      title: `Fuzz Truncation len=${sliceLen}`,
      category: "fuzz",
      input: {
        encoding: "utf8-text",
        data: sliced,
      },
      stream: {
        endReason: "length",
        chunkStrategies: ["single", "byte-per-chunk"],
      },
      expected: {
        syntax: "incomplete",
        outcome: "truncated",
        executable: false,
        diagnostics: [{ code: "E_STREAM_TRUNCATED", severity: "error", recoverable: false }],
        repairs: [],
        events: []
      },
      provenance: { source: "synthetic" }
    });
  }
}

generateStringMutations();
generateDepthMutations();
generateTruncationMutations();

console.log(`Generated ${counter - 1} fuzz fixtures in corpus/fuzz`);
