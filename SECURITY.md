# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue containing vulnerability details.**

Use GitHub's private vulnerability reporting for this repository when available. If that option is not available, contact the maintainer through the GitHub profile before sharing sensitive reproduction details publicly.

A useful report includes:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Scope

This library parses untrusted JSON input from LLM streaming endpoints and can be used to gate side-effecting tool execution. Security-relevant concerns include:

- **Execution integrity**: Truncated, malformed, schema-invalid, provider-failed, or otherwise unconfirmed tool-call input must not be represented as safely executable.
- **Denial of service**: Adversarial payloads designed to cause excessive memory or CPU consumption. The parser enforces configurable limits on input size, nesting depth, string length, and event queue size.
- **Memory/resource safety**: The implementation avoids intentionally unbounded parser state and keeps resource limits explicit.
- **No dynamic code execution**: The parser never uses `eval`, `Function`, or similar dynamic code execution.
- **No network I/O in the library**: Provider adapters normalize events supplied by callers; the package does not make provider or tool network requests on its own.
- **Runtime dependencies**: JSON Schema validation uses AJV. Dependency changes should be reviewed with the same safety and maintenance scrutiny as parser changes.

## Supported Versions

This project is pre-1.0 (see [README.md](README.md) for what's currently
considered stable). Security fixes are applied to the latest published
version only — there is no back-port policy across older minor versions.
