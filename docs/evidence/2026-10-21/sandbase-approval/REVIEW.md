# Independent comparison review

Method: an independent read-only source review first derived the policy from
the pinned Sandbase tests and contributor rules, before receiving experiment
artifacts. A second pass inspected the test patch, native helper, installed
packages and all 15 raw rows, and recomputed their selected lifecycle hashes.
The reviewer did not run Vitest. Test execution and final CI verification are
separate. This operator-arranged review is not independent adopter evaluation.

No blocking fairness defect was found for the five selected cases:

- Production source, manifest and lock were unchanged.
- All modes preserved native `needsApproval: true` and omitted model-facing
  execute; all 15 records show zero attempted/successful preapproval writes.
- Script hashes and selected initial lifecycle arrays match across modes.
- Real SessionManager, executor, SQLite, resolver and sandbox remain in use.
- C uses JSON.parse plus existing Zod and the actual schema, not PSJ admission.
- Fresh database reads, actual file contents and post-success write counts
  support the persistence/effect measurements.
- Every duplicate is rejected by unchanged application controls, with no extra
  writes or continuation requests.

The records support A 5/5, B 2/5, C 5/5. B's schema-invalid case is an attempted
write that fails, not a successful invalid write. Its schema behavior is caused
by this application's `jsonSchema(parameters)` without an optional validator,
not an inability of SDK7 to validate schemas. The raw/projection conflict is a
valid raw call that must succeed under the existing policy; treating its refusal
as a success would be unfair.

Limits: authored scripted fixtures; selected lifecycle fields rather than a
complete wire capture; no process-restart/crash replay test; temporary DB/files
removed by existing teardown after measurement. The defensible conclusion is
equivalent measured A/C behavior with maintenance preference unmeasured. Neither
a unique PSJ replay benefit nor a maintenance advantage was demonstrated.

A final pass verified the reusable runner, exact patch hash, all seven command
exits, the pristine 13-case log and final A/C outcome equality. A nonblocking
observation about lexical output-path checking was addressed by resolving the
source and existing output parent before checking their relationship. The
reviewed run's actual output was already outside the checkout. CI results are
verified separately on the delivery commit.
