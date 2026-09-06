# v1.0 criteria

This project is pre-1.0 by design — see `docs/COMPATIBILITY.md`'s own
versioning policy. This document states what "ready for v1.0" means so
that judgment call is made against a standing bar, not a mood. No dates
are promised; this is a checklist, not a roadmap commitment.

- **Stable execution gate API.** `createToolCallExecutionGate()` and the
  decision shape it returns (`ExecutionAction`/`ExecutionReason`/
  `ExecutionDecision`) hold across at least one full pre-1.0 release cycle
  with zero breaking changes, not just zero changes so far.
- **Stable validator interface.** `ToolInputValidator` (introduced 0.5.0)
  proves itself against real integrations — at minimum, one real adopter
  using a non-Ajv validator (Zod, TypeBox, Valibot, or Standard Schema) in
  production, not just the Ajv backwards-compatibility path.
- **Stable conformance fixture version.** The `conformance/` fixture
  format (`version: 1`) holds without a breaking format change, and the
  corpus has grown past the initial 15-fixture seed with real usage
  driving additions, not just this release's own authorship.
- **Zero or justified minimal runtime dependencies.** Either `ajv` moves
  to an optional peer dependency (see `docs/VALIDATION.md` for why that
  requires a major version, not a patch), or the decision to keep it
  mandatory is re-examined and re-justified against real adopter data at
  that point.
- **≥1 independent external runtime adopter**, already true today
  (`docs/CASE_STUDY_SANDBASE.md`) — v1.0 asks this to be durable across a
  real breaking-change negotiation, not just a point-in-time fact.
- **≥2 additional external integrations or conformance consumers** —
  either adopters of the package itself, or projects that run the public
  conformance corpus against their own implementation without installing
  this package at all (see `docs/CONFORMANCE.md`'s future compatibility
  matrix).
- **Provider compatibility documented and current** — `docs/COMPATIBILITY.md`
  reflects the exact provider/SDK versions actually verified, kept
  current as new majors ship, not allowed to go stale the way the old
  README version banner did.
- **Release provenance mature** — the existing npm provenance and
  `verify:published-release` tooling (`docs/RELEASE_INTEGRITY.md`)
  continues to pass on every release with no manual override needed.
- **Mutation/fuzz/invariant gates healthy** — the existing Stryker
  mutation suite, fuzz tests, and invariant tests continue to pass at
  their current bar with no unaddressed regression, including for
  whatever new surface (validation, conformance) 0.5.0 introduced.
