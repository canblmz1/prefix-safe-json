# Adoption Lab Framework Comparison

| Framework | Current Parser | Time Complexity | Truncation Safety | Non-Fabrication Guarantee | Zero Runtime Dependencies | Adapter Status |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Vercel AI SDK** | `parsePartialJson` / `JSON.parse` | $O(n^2)$ | Moderate | No | No (Internal pkgs) | **Verified** |
| **LangChain.js** | String Buffer + `JSON.parse` | $O(n^2)$ | Low | No | No | **Verified** |
| **Mastra** | `jsonrepair` + Zod | $O(n^2)$ | Moderate | **No (Fabricates data)** | No | **Verified** |
| **Stagehand** | `partial-json` | $O(n^2)$ | Moderate | No | No | **Verified** |
| **Goose** | Try/Catch `JSON.parse` Polling | $O(n^2)$ | Low | No | No | **Verified** |
| **@internal/incremental-tool-json** | **Incremental State Machine** | **$O(n)$** | **High** | **Yes (Proven)** | **Yes (0 deps)** | **Core Engine** |
