# Devam — a portable record of AI-assisted work

An experimental companion product for three audiences: everyday AI users,
people coding with AI, and developers building AI applications. The shared
job is to carry the current request, the basis for completion claims, and
unfinished work into another conversation.

This is a working product hypothesis, not a claim of novel invention,
proven retention, or independent adoption. It does not change the published
PSJ runtime or require PSJ for its task-state operations.

## Run

From the repository root, with Node 22+:

```bash
node experiments/devam/server.mjs
```

Open **http://127.0.0.1:4317**. An optional numeric argument changes the port.
The app needs no install, account, API key, model request or external asset.
The static server binds only to loopback.

## Try the complete workflow

1. Open one of the three example tasks, or create your own. Edit the latest
   request and one requirement per line.
2. Record what the AI says it completed. The result stays **AI reported**.
3. Attach an actual local file to a requirement. The app hashes the bytes;
   it does not store or transmit the file content. Read the file yourself,
   check it against the requirement, and record your review.
4. Change the request. Previous reviews need rechecking. Reattaching changed
   file bytes also removes the current review. A review can be undone.
5. Copy the continuation packet to the next conversation. It includes the
   current request, identified requirements, explicit claim/review states
   and file fingerprints. Supply any needed source files separately.
6. Paste back the AI's single JSON report. Its project ID and request
   revision must match; unknown requirements and extra authority fields are
   refused. A report never grants a review or changes the user's request.

Each example opens a separate task; it does not discard your existing one.
The JSON download is a portable backup. Opening it creates a separate local
record and marks imported reviews for rechecking. A normal reload preserves
local review history.

## Data and verification limits

- State lives in this browser's local storage, with a limit of 12 tasks and
  20 requirements per task. Browser data can be cleared; download backups.
- A fingerprint establishes byte identity, not truth, authorship, test
  execution, freshness at another machine, or the semantic correctness of
  the file. The app cannot see a file change until you select that file again.
- Review is a user-editable local statement. It is not authenticated identity,
  application permission, an execution token or a tamper-proof audit log.
- The app does not read hidden chat histories or automatically synchronize
  accounts. Copy/paste and file selection are explicit actions.
- Task edits are versioned; this prototype does not keep a full revision
  archive, recover deleted chats, perform semantic contradiction detection,
  or guarantee that the next AI follows the packet.
- No browser extension, SDK integration, cloud synchronization or automatic
  claim extraction is installed. The typed model is an experimental local
  module, not a supported npm subpath or integration API.

## Validation

`test/integration/devam-work-passport.test.ts` exercises identity/revision
binding, claims versus reviews, changed requests/files, portable imports,
malformed data, actual SHA-256 bytes and handoff boundaries in normal CI.

The optional browser acceptance test requires Python Playwright and Chromium.
With the local server running, use:

```bash
python experiments/devam/test-ui.py
```

It covers actual UI interactions, clipboard, uploads/downloads, persistence,
all three audience examples, HTML-shaped input displayed as text, and mobile
layout. Reports and screenshots go to ignored `artifacts/devam-ui/`.
Package release coverage retains its 95% floors and measures `src/**/*.ts`;
the experiment's browser code is not claimed to have that coverage.

See [RESEARCH.md](RESEARCH.md) for the pain reports, alternatives and the
evidence still needed before further product investment.
