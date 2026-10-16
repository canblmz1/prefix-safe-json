# Installed-package trials

These examples require Node 22+ and npm. Each directory installs published
`prefix-safe-json@0.5.3` in an independent project and uses a mock transport or
mock model. No API key, model server or repository build is needed.

Choose one directory:

| Directory | Installed SDK | What it checks |
| --- | --- | --- |
| `npm-consumer` | AI SDK `7.0.77`, Zod `4.4.3` | Termination, validation, interleaved calls and identity |
| `openai-consumer` | OpenAI `7.34.0` | Chat Completions termination, identity and provider-honesty limit |
| `anthropic-consumer` | Anthropic `0.123.0` | Final `message_stop`, truncation and late input |
| `langchain-consumer` | LangChain OpenAI `1.5.8`, core `1.2.9` | Parsed candidates versus original provider evidence |

From the chosen directory run `npm install --engine-strict --no-audit --no-fund`,
then `npm start`. For `npm-consumer`, also run `npm run batch` and
`npm run identity`. The only tool effects are in-memory counters.

A passing example verifies selected authored scenarios. To verify your own
integration, connect a harmless tool to your application's actual stream and
execution boundary, then [report the result or blocker](https://github.com/canblmz1/prefix-safe-json/blob/main/docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
