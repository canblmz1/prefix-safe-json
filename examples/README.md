# Installed-package trials

For normal AI SDK `execute` callbacks and automatic tool-result continuation,
start with the [guarded chat example](guarded-chat/). It installs the separate
experimental integration preview alongside published PSJ `0.6.1`. Its complete
case reaches a final answer; three refused batch cases run no callbacks.
The first integration buffers each full response, delaying its first chunk.

For typed argument inference and a complete caller-owned tool-result-to-model
loop, use the [TypeScript agent-loop example](typed-agent-loop/) with PSJ
`0.6.1`, AI SDK `7.0.143` and Zod `4.4.3`. It checks five authored scenarios.
The six earlier SDK trials below retain their published `0.5.4` pins.

From a current checkout, the default command runs guarded chat in a new
temporary project:

```bash
node scripts/try-npm-demo.mjs
```

Pass `typed` explicitly for the caller-owned trial. Its complete control makes two
model requests, dispatches both authorized calls and returns a final answer.
The other four scenarios cover token limits, duplicate IDs, cancellation and
a tool error. These are authored fixtures, not live model requests.

These examples require Node 22+ and npm. Each directory installs the PSJ
version pinned in its manifest in an independent project and uses a mock transport or
mock model. No API key, model server or repository build is needed.

Download and extract the [six-SDK trial ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip),
or use this repository checkout. From its root, run:

```bash
node scripts/try-npm-demo.mjs tanstack
```

Replace `tanstack` with `ai-sdk`, `openai`, `anthropic`, `langchain` or
`openrouter` to select another SDK. The launcher creates a separate temporary
project, installs published PSJ `0.5.4`, prints the installed versions and runs
the checks. It leaves the project available for editing and rerunning.

Each choice corresponds to one directory:

| Directory | Installed SDK | What it checks |
| --- | --- | --- |
| `npm-consumer` | AI SDK `7.0.77`, Zod `4.4.3` | Termination, validation, interleaved calls and identity |
| `openai-consumer` | OpenAI `7.34.0` | Chat Completions termination, identity and provider-honesty limit |
| `anthropic-consumer` | Anthropic `0.123.0` | Final `message_stop`, truncation and late input |
| `langchain-consumer` | LangChain OpenAI `1.5.8`, core `1.2.9` | Parsed candidates versus original provider evidence |
| `openrouter-consumer` | OpenRouter Agent `0.11.0`, SDK `0.13.67` | Manual dispatch, whole-batch refusal and matched results in the next model request |
| `tanstack-consumer` | TanStack AI `0.69.0`, OpenRouter `0.22.0`, SDK `0.13.20` | Raw native finish reasons, usage trailers and paired server-tool results; requires PSJ `0.5.4` |

For TanStack's PSJ-free native baseline and an optional npm or source-build
comparison, use the [standalone trial](https://gist.github.com/canblmz1/ba1e62d792da37d3f420c328f56d81be).

To run a directory directly, use `npm install --engine-strict --no-audit --no-fund`,
then `npm start`. For `npm-consumer`, also run `npm run batch` and
`npm run identity`. The only tool effects are in-memory counters.

A passing example verifies selected authored scenarios. To verify your own
integration, connect a harmless tool to your application's actual stream and
execution boundary, then [report the result or blocker](https://github.com/canblmz1/prefix-safe-json/blob/main/docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
