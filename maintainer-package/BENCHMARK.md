# BENCHMARK METHODOLOGY & EMPIRICAL RESULTS

## Benchmark Setup
* **Runner**: Vitest Bench (`vitest bench --run`)
* **File Source**: `test/bench/parser.bench.ts`
* **Node Version**: Node 20.11.0
* **Platform**: Windows 11 x64 (AMD Ryzen 9 7900X)
* **Iterations**: 100+ warm-up iterations, 1,000+ measurement samples per test.

---

## Measured Performance Data

### 1. Small Payload Parsing (100 Bytes)
| Parser | Ops/sec (hz) | Mean Time (ms) | Min (ms) | Max (ms) | Relative Margin of Error |
|---|:---:|:---:|:---:|:---:|:---:|
| `JSON.parse` | 1,073,634 | 0.0009 ms | 0.0003 ms | 0.045 ms | ±2.1% |
| `partial-json` | 397,875 | 0.0025 ms | 0.0008 ms | 0.082 ms | ±3.8% |
| `jsonrepair` | 352,267 | 0.0028 ms | 0.0009 ms | 0.091 ms | ±4.2% |
| `IncrementalJsonParser` | 88,142 | 0.0113 ms | 0.0041 ms | 0.125 ms | ±5.1% |

### 2. 100KB Payload Parsing (Single Pass)
| Parser | Ops/sec (hz) | Mean Time (ms) | Relative Margin of Error |
|---|:---:|:---:|:---:|
| `JSON.parse` | 819.45 | 1.22 ms | ±5.68% |
| `jsonrepair` | 67.38 | 14.83 ms | ±23.47% |

### 3. Streaming Payload (100KB Payload via 100-Byte Chunks)
| Parser Engine | Streams/sec | Mean Stream Latency (ms) | Peak Allocations |
|---|:---:|:---:|:---:|
| `clarinet` | 468.99 | 2.13 ms | Low |
| `IncrementalJsonParser` | 17.11 | 58.45 ms | Low (`O(1)` event queue) |

---

## Theoretical Complexity Analysis

* **Full-Buffer Re-Parsers (`parsePartialJson`, `jsonrepair`, try/catch `JSON.parse`)**:
  - Processing chunk $i$ of length $k$ requires processing the accumulated string of length $i \times k$.
  - Total character operations for $N$ chunks: $\sum_{i=1}^N i \cdot k = k \cdot \frac{N(N+1)}{2} = \mathcal{O}(N^2 \cdot k)$.
* **Incremental Parser (`IncrementalJsonParser`)**:
  - Processing chunk $i$ of length $k$ reads only the $k$ new bytes.
  - Total character operations for $N$ chunks: $\sum_{i=1}^N k = N \cdot k = \mathcal{O}(N \cdot k)$.
