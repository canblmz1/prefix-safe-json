# Strands Responses reference check

This is an optional discovery artifact for
[the independent report #4158](https://github.com/strands-agents/harness-sdk/issues/4158).
It runs published packages through the real Strands `Agent`, `OpenAIModel`,
tool factory, callback and result continuation. Its injected client supplies
scripted Responses objects; no live provider or HTTP/SSE parsing is tested.

The reporter's partial/no-argument cutoff fixtures are retained, plus one
healthy control. The `write_file` callback is the reporter's memory-only
counter: its textual “wrote” result is not a disk write.

## Run in a clean directory

Copy this directory outside any workspace, with no `node_modules` or links.
Node 22+ is required.

```sh
npm ci --ignore-scripts --strict-peer-deps --engine-strict --no-audit --no-fund
npm test
```

The private manifest locks SDK **1.22.0**, OpenAI **6.45.0**, PSJ core
**0.6.3**, and Zod **4.6.7**. No application or SDK source is patched.
Use a new `PSJ_RESULT` filename for another run; existing results are never
overwritten. The default output is `result.json`.

## Measured outcome

| Fixture | Released SDK | Small native control | PSJ raw check |
| --- | --- | --- | --- |
| Healthy | 1 callback; 2 requests; `call_1` preserved | Same | Same |
| Partial JSON + max tokens | 0 callbacks; `ModelError` | 0; `MaxTokensError` | 0; `ModelError`, cause `PSJRefusal` |
| No argument bytes + max tokens | **1 callback with `{}`; success result; 2 requests** | **0 callbacks; 1 request; `MaxTokensError`** | **0 callbacks; 1 request; `ModelError`, cause `PSJRefusal`** |

Partial JSON is already refused natively and shows no additional callback
protection. In the no-argument case, the schema intentionally matches the
reporter's optional fields and accepts `{}`. Required-field schemas may reject
that input independently; that alternative is not bypassed here.

All clients receive the same original event objects and use the same tool
schema and installed versions. Fixture hashes, callback input/ID, original
outgoing tool-result IDs, errors, in-memory histories and request counts are
retained in `operator-result.json`. PSJ consumes one authority for the healthy
call, refuses both cutoffs without consuming any, and cannot consume the
healthy authority twice.

The native control subclasses the public model's `stream()` method and changes
only the terminal event's precedence when the original response is incomplete
due to `max_output_tokens`. It implements the condition proposed by the
approved, still-open [native PR #4159](https://github.com/strands-agents/harness-sdk/pull/4159).
That PR was not installed or built, and remains untouched. The real SDK
aggregator and Agent perform the rest of the work.

PSJ preflights this finite response before releasing events to the SDK, then
matches original ID, tool name and exact value in the callback. This is a
single-call fixture helper, not a new production adapter or concurrency,
approval, transport, cancellation or persistence guarantee. Native control
and PSJ have equal callback outcomes here, but expose different error contracts.
Recovery equivalence was not evaluated; neither is claimed to be a drop-in
substitute for the other.

## Evidence and decision

The initial clean Windows 11 build 26200 installation used Node **22.23.2**
and npm **10.9.8** with strict peers/engines and a new empty package cache;
54 registry packages installed, exit 0. `npm test` passed **9/9**, exit 0.
`operator-environment.json` records the source and lock SHA-256 hashes.
The SDK emitted its default-model warning; all three paths used that same
SDK default (`gpt-5.4`) against the scripted client. No live provider request was made.

The SDK 1.22.0 tarball SHA-256 is
`e4b60ccd7f971aa34a4f5c022c1b62ecda3a497d88e1518fffb4e0cae4fff55e`;
registry SHA-512 integrity was verified before source inspection. Current
code and package evidence supersede any assumption based on the old
standalone TypeScript repository.

A separate source-only consumer then copied only the manifest, lockfile and
evaluation script. Its frozen `npm ci` with strict peers/engines and a separate
empty cache installed 54 packages, exit 0; one `npm test` invocation passed
**9/9**, exit 0. Sources stayed unchanged and registry package directories were
not links. `frozen-install-receipt.json` and `frozen-result.json` preserve that
second operator validation; callback/request/error/identity records match the
first. Local paths in the public receipt are replaced with placeholders;
the original local record is preserved. These **18 checks** are two operator
runs, not two independent users.

The hypothesis to ask the maintainer is whether an optional independent raw
reference earns a place in SDK-upgrade checks, or their small native regression
fully covers the need. No lower maintenance cost, extra callback protection
over that fix, independent acceptance or continued PSJ use has been established.
