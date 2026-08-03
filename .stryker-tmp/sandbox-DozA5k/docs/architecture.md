# Architecture

The incremental JSON parser is designed with a pipeline architecture, streaming data from raw bytes to semantic events without holding the entire document in memory.

## Layer Diagram
`UTF-8 Decoder` → `Lexical Scanner` → `Grammar Stack` → `Semantic Builder` → `Parser API`

## Data Flow
1. **`push(chunk)`**: The user pushes a `string` or `Uint8Array`.
2. **Decode Bytes**: The UTF-8 Decoder handles incoming bytes, buffering partial multi-byte sequences.
3. **Feed Chars**: Complete characters are fed to the Lexical Scanner.
4. **Emit Tokens**: The Scanner processes characters using its state machine and emits tokens (e.g., string literals, structural characters).
5. **Process Tokens**: The Grammar Stack receives tokens, enforces JSON structure, manages paths, and checks for duplicates.
6. **Emit Events**: The Semantic Builder constructs JSON pointer paths and queues semantic events.

## Layer Responsibilities
- **UTF-8 Decoder**: Handles character boundaries securely. Exposes a clean character stream to the scanner.
- **Lexical Scanner**: Maintains lexical states. Tokenizes primitive values and structural characters.
- **Grammar Stack**: Tracks the container hierarchy, expectations (e.g., value vs. comma), and ensures structural integrity.
- **Semantic Builder**: Converts grammar state and tokens into high-level events (`value_committed`, `container_closed`).
- **Parser API**: The public surface area orchestrating the pipeline and exposing state (`snapshot()`, `drainEvents()`).

## State Management
- **Scanner State**: Current lexical mode (e.g., inside a string, reading a number).
- **Grammar Stack**: A stack of frame objects tracking open objects/arrays, seen keys, and paths.
- **Pending Buffers**: Small buffers for incomplete UTF-8 bytes or pending number characters waiting for a terminator.

## Memory Model
- **No Unbounded History**: The parser only retains the `stableValue` tree (which grows with the document but represents the final output) and the grammar stack (bounded by `maxDepth`).
- **Drain-and-Clear Event Queue**: Semantic events are stored in a queue. Calling `drainEvents()` clears the queue, preventing unbounded memory growth for events.

## Error Handling
- **Diagnostics**: Used for input anomalies (e.g., malformed LLM JSON). Recorded in the snapshot and as events. They do not throw exceptions.
- **Exceptions**: Reserved strictly for programming errors by the consumer (e.g., calling `push()` after `finish()`, invalid initialization).
