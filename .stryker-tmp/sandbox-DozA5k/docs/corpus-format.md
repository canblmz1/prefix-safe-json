# Corpus Format Documentation

To guarantee the robustness of the parser, we use a comprehensive test corpus. 

## `CorpusFixture` Interface
Each fixture in the corpus adheres to the following interface:

```typescript
interface CorpusFixture {
  name: string;
  category: string;
  input: Uint8Array | string;
  expectedFinalValue: any;
  expectedDiagnostics: string[];
  expectedExecutable: boolean;
  chunkStrategies: string[];
}
```

## Field Descriptions
- `name`: Unique identifier for the test case.
- `category`: Taxonomy bucket (e.g., `utf8`, `limits`, `duplicates`, `llm_anomalies`).
- `input`: The raw data to parse.
- `expectedFinalValue`: The expected `stableValue` after `finish()`.
- `expectedDiagnostics`: An array of expected diagnostic codes.
- `expectedExecutable`: Boolean asserting the final `executable` state.
- `chunkStrategies`: Strategies to apply during testing (e.g., `["single", "byte-by-byte", "random-split"]`).

## Chunk Strategies
Because chunk invariance is a core invariant, fixtures are run multiple times with different chunking strategies:
- **single**: The entire input is pushed in one call.
- **byte-by-byte**: Input is pushed one byte/character at a time.
- **random-split**: Input is randomly sliced into multiple chunks.

## Category Taxonomy
- **rfc8259**: Standard JSON compliance tests.
- **utf8**: Multi-byte boundary and invalid encoding tests.
- **limits**: Depth, string length, and byte limit enforcement.
- **duplicates**: Duplicate key policy enforcement.
- **llm_anomalies**: Unescaped control chars, trailing text, etc.

## Adding New Fixtures
1. Create a new JSON or JS object matching the `CorpusFixture` interface.
2. Place it in the appropriate category directory in the corpus folder.
3. Ensure all fields are explicitly defined.

## Validation Process
The automated test suite dynamically loads all fixtures, executes them against all specified `chunkStrategies`, and asserts that the final parser state strictly matches the expectations. Any deviation fails the test suite.
