# Security Policy

## Reporting a Vulnerability

Report vulnerabilities through GitHub's private reporting form:

https://github.com/canblmz1/prefix-safe-json/security/advisories/new

Do not open a public issue containing exploit details before coordinated
disclosure. If the private form is unavailable, contact the maintainer through
the GitHub profile without including sensitive reproduction details publicly.

Reports should include the affected version, impact, reproduction steps, and
any suggested mitigation. The maintainer will acknowledge the report when
practical, validate and triage it, coordinate remediation, and agree on public
disclosure with the reporter. No fixed response-time guarantee is made.

## Scope

This library parses untrusted JSON input from LLM streaming endpoints and can be used to gate side-effecting tool execution. Security-relevant concerns include:

- **Execution-integrity bypasses**: Any path that could represent truncated,
  malformed, schema-invalid, provider-failed, identity-ambiguous, or otherwise
  unconfirmed tool-call input as safely executable is security-sensitive.
- **Denial of service**: Adversarial payloads designed to cause excessive memory or CPU consumption. The parser enforces configurable limits on input size, nesting depth, string length, and event queue size.
- **Memory/resource safety**: The implementation avoids intentionally unbounded parser state and keeps resource limits explicit.
- **No dynamic code execution**: The parser never uses `eval`, `Function`, or similar dynamic code execution.
- **No network I/O in the library**: Provider adapters normalize events supplied by callers; the package does not make provider or tool network requests on its own.
- **Runtime dependencies**: JSON Schema validation uses AJV. Dependency changes should be reviewed with the same safety and maintenance scrutiny as parser changes.

## Supported Versions

This project is pre-1.0 (see [README.md](README.md) for what is currently
considered stable). Only the latest published version is supported for
security fixes; older minor versions do not have a backport policy.
