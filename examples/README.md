# Installed-package trials

These examples require Node 22+ and npm. Each directory installs the PSJ
version pinned in its manifest in an independent project and uses a mock transport or
mock model. No API key, model server or repository build is needed.

Choose one directory:

| Directory | Installed SDK | What it checks |
| --- | --- | --- |
| `npm-consumer` | AI SDK `7.0.77`, Zod `4.4.3` | Termination, validation, interleaved calls and identity |
| `openai-consumer` | OpenAI `7.34.0` | Chat Completions termination, identity and provider-honesty limit |
| `anthropic-consumer` | Anthropic `0.123.0` | Final `message_stop`, truncation and late input |
| `langchain-consumer` | LangChain OpenAI `1.5.8`, core `1.2.9` | Parsed candidates versus original provider evidence |
| `openrouter-consumer` | OpenRouter Agent `0.11.0`, SDK `0.13.67` | Manual dispatch, whole-batch refusal and matched results in the next model request |
| `tanstack-consumer` | TanStack AI `0.69.0`, OpenRouter `0.22.0`, SDK `0.13.20` | Raw native finish reasons, usage trailers and paired server-tool results; requires PSJ `0.5.4` |

For TanStack's native baseline and a comparison built directly from public
PSJ source, use the [verified source trial](https://gist.github.com/canblmz1/ba1e62d792da37d3f420c328f56d81be).
It works independently of the candidate's npm release availability.

From the chosen directory run `npm install --engine-strict --no-audit --no-fund`,
then `npm start`. For `npm-consumer`, also run `npm run batch` and
`npm run identity`. The only tool effects are in-memory counters.

A passing example verifies selected authored scenarios. To verify your own
integration, connect a harmless tool to your application's actual stream and
execution boundary, then [report the result or blocker](https://github.com/canblmz1/prefix-safe-json/blob/main/docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
