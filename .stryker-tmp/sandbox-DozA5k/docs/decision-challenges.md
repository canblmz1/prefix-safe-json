# Decision Challenges & Trade-offs

Building an incremental JSON parser involves balancing performance, strictness, and memory usage.

## Known Trade-offs and Challenges

### Memory Overhead of Grammar Stack Key Tracking
- **Challenge**: Enforcing the "first-wins" duplicate key policy requires tracking every key seen in the current object frame.
- **Trade-off**: This increases memory usage per object. For massive objects with thousands of keys, the memory footprint of the stack frame grows significantly, which must be balanced against the `maxDepth` and `maxInputBytes` resource limits.

### Complexity of Surrogate Pair Handling
- **Challenge**: Processing UTF-16 surrogate pairs split across chunk boundaries adds significant state machine complexity.
- **Trade-off**: Requires dedicated `unicode_escape` and `unicode_surrogate_pending` lexical states and buffers, slightly impacting the fast-path tokenization loop.

### Number Commit Delay Perceived Latency
- **Challenge**: Numbers cannot be committed until a structural terminator (comma, bracket, whitespace) is seen.
- **Trade-off**: If a stream stalls immediately after emitting the digits of a number, the UI will experience latency waiting for the value, as the parser cannot safely commit it.

### Strictness vs. Permissiveness for LLM Output
- **Challenge**: LLMs frequently produce slightly malformed JSON.
- **Trade-off**: Strict rejection ensures data integrity but breaks user experience. Permissive repair risks hallucinated semantics. The current policy isolates this via diagnostics and strict limits on what is *never* repaired (e.g., fabricating values).

### Event Ordering Guarantees vs. Processing Performance
- **Challenge**: Emitting precise JSON Pointer paths and deterministic sequences for every structural change.
- **Trade-off**: Constructing string paths and allocating event objects for every node impacts raw throughput. Mitigated by the drain-and-clear queue approach.
