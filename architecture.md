# Adoption Lab Architecture

## System Overview

The Adoption Lab provides zero-invasive, isolated integration adapters for 5 major open-source AI frameworks:

```
                  ┌──────────────────────────────────────────────┐
                  │    @internal/incremental-tool-json Core     │
                  └──────────────────────┬───────────────────────┘
                                         │
     ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
     ▼                   ▼               ▼               ▼                   ▼
┌──────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────────┐  ┌──────────────────┐
│  vercel-ai   │  │  langchain  │  │  mastra   │  │  stagehand  │  │      goose       │
└──────────────┘  └─────────────┘  └───────────┘  └─────────────┘  └──────────────────┘
  Middleware        OutputParser     ToolEngine     ActionExtractor   StreamAdapter
```

## Design Constraints

1. **Zero Upstream Modifications**: Upstream code is never modified directly during experimental lab validation.
2. **Removable Architecture**: Deleting an adapter directory (`adapters/<framework>`) cleanly removes all integration code.
3. **Public API Preservation**: Wraps existing framework types (`tool-call-delta`, `AIMessageChunk`, `tool_input_delta`) seamlessly.
