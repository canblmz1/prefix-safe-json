# Maintainer trial drafts — not sent, October 21, 2026

Alternatives for an authorized follow-up on existing PRs. No new thread or
message was sent. Independent runs, acceptance and continued use remain
unconfirmed. Do not resend merely because a thread is silent. Each draft
permits a native-only or remove decision.

## localmd — existing SDK-upgrade checks

For [draft PR 1](https://github.com/whitefoxx/localmd/pull/1):

> I maintain PSJ. At `fefb45e6256f0bf057bb21e8bbb94a31663aca55`, the candidate
> pins npm `psj-ai-sdk@0.3.2`; other locked versions and the production loop are
> unchanged. Original-response cases sit beside your tool-history tests. My
> clean installs and runs establish preparation, not your evaluation.

With Node 22+, in a fresh directory:

```sh
git clone --config core.autocrlf=false --config core.eol=lf --branch test/raw-stream-regressions https://github.com/canblmz1/localmd.git localmd-psj-trial
cd localmd-psj-trial
git switch --detach fefb45e6256f0bf057bb21e8bbb94a31663aca55
npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund
npx --no-install vitest run src/agent/run.test.ts src/agent/tool-stream-regression.test.ts src/agent/tool-stream-recording.test.ts
npm run typecheck
```

> Expected: nine tests pass, typecheck exits 0; healthy callbacks/results and
> continuation remain, refused groups release zero callbacks. No model key is
> needed. Full browser verification is not uniformly green; this asks only
> about development checks. Would you keep this control during SDK upgrades,
> and why? A small raw-ID check is also an alternative; PSJ is not necessary
> for that rule alone. Commit, outcome/first blocker and keep/remove reason
> suffice. A later independent upgrade run is separate evidence of continued use.

## AgentUse — Code Mode provider-boundary regression task

For [draft PR 25](https://github.com/agentuse/agentuse/pull/25):

> I maintain PSJ. Your transport-recovery tests already make this boundary a
> recurring maintenance task. At `7d8a66cb4aee6b9faa0dd65ec2c0f315ddd76a12`,
> eight authored comparisons run through the actual runner/Code Mode dispatcher
> with memory-only tools, retaining AI 7.0.128/provider 3.0.63. They are not
> production-incident captures and do not replace approvals.

In a fresh directory, use the project's pinned pnpm toolchain and Bun runner:

```sh
git clone https://github.com/agentuse/agentuse.git agentuse-psj-trial
cd agentuse-psj-trial
git fetch origin pull/25/head
git switch --detach 7d8a66cb4aee6b9faa0dd65ec2c0f315ddd76a12
pnpm install --frozen-lockfile
bun test tests/raw-tool-stream-batches.test.ts
bun test tests/model-stream-transport-drop.test.ts
```

> Expected: eight new comparisons and 18 transport cases pass in separate
> processes. Healthy calls retain two effects, original IDs and final response.
> Native length already prevents effects; additional whole-group/identity
> policy is the question. The broader approval suite failed in both operator
> controls, so this is not full-application certification. Would you keep these
> checks for SDK upgrades, or are native behavior and a small local check enough?
> Please record commit, outcome/first blocker and keep/remove reason. No
> production adapter change is requested.

## Phoronis — greeting updates during provider upgrades

For [PR 12](https://github.com/skrylnikov/Phoronis-tg-bot/pull/12):

> I maintain PSJ. At `b84198e03a86d779f56d2308655c203103f021b2`, greeting wire
> tests exercise your actual `chatGeneration` and admin check with repository/
> Telegram spies. Retained AI 7.0.77/provider 3.0.35 already blocks the duplicate-ID
> fixture; the previously evaluated provider upgrade changes it. This is an
> authored upgrade-policy comparison, not a real incident or request to change
> your Bun production loop.

In a fresh directory, with the project's Bun 1.4.0 toolchain:

```sh
git clone https://github.com/skrylnikov/Phoronis-tg-bot.git phoronis-psj-trial
cd phoronis-psj-trial
git fetch origin pull/12/head
git switch --detach b84198e03a86d779f56d2308655c203103f021b2
bun install --frozen-lockfile
bun run test -- src/__tests__/chat-generation-wire.test.ts
bun run typecheck
```

> Expected: twelve new wire cases pass on retained pins, including healthy
> updates, original result IDs/continuation and zero non-admin updates;
> typecheck exits 0. No bot/database credentials are needed for these mocked
> tests. Would you keep original-response checks for provider upgrades, and why,
> or retain only a native regression? A small raw-ID check can enforce identity
> without PSJ; transforming schemas or production Bun need a separate compatibility
> decision. Commit, outcome/first blocker and keep/remove reason suffice.
