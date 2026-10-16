# LangChain raw-evidence comparison

Copy this directory outside the repository. With Node 22+:

```bash
npm install --engine-strict --no-audit --no-fund
npm ls prefix-safe-json @langchain/openai @langchain/core
npm start
```

This pins `@langchain/openai@1.5.8` and `@langchain/core@1.2.9`, the versions
in [LangChain.js #11469](https://github.com/langchain-ai/langchainjs/issues/11469),
and published `prefix-safe-json@0.5.3`. It uses the installed `ChatOpenAI.stream()`
with a local mock fetch response. No API key or live request is required.

The same original OpenAI-compatible envelopes feed PSJ's existing adapter;
the LangChain message is printed for comparison. Only a value consumed from
`takeDecision()` reaches the harmless in-memory dispatch. Expected effects:
**1 / 0 / 0** for a complete call, a mid-string token-limit cutoff, and a
complete JSON object with token-limit termination. Each call's authority can
be consumed at most once.

This is a deterministic SDK-parser comparison, not a production LangChain
adapter. The fixture already owns the raw envelopes; a real integration must
preserve those events and terminal evidence at its actual provider boundary.
Parsed `message.tool_calls` cannot recreate that evidence. AgentExecutor,
LangGraph, application retries, and live-provider behavior are not exercised.

[Report a project-level result or blocker](https://github.com/canblmz1/prefix-safe-json/issues/new?template=integration.yml)
after trying the boundary in your own development environment. Running this
mock comparison alone is separate from project integration evidence.
