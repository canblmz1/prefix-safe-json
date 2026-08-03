# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue for security vulnerabilities.**

Instead, send an email describing the vulnerability. Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Scope

This library parses untrusted JSON input from LLM streaming endpoints. Security-relevant concerns include:

- **Denial of service**: Adversarial payloads designed to cause excessive memory or CPU consumption. The parser enforces configurable limits on input size, nesting depth, string length, and event queue size.
- **Memory safety**: While TypeScript/JavaScript provides memory safety guarantees, the parser avoids unbounded allocations and ensures all loops terminate.
- **No code execution**: The parser never uses `eval`, `Function`, or any form of dynamic code execution.
- **No network access**: The parser is a pure computation library with zero runtime dependencies and no network I/O.

## Supported Versions

This project is in **alpha** stage. Security fixes will be applied to the latest version only.
