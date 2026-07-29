# Shape Skills Static Conformance And Read-Only Behavioral Canaries

Evaluate all five shipped skills against the current Shape v0.7.0 CLI. This is
a blocking release-candidate check with two layers:

1. static conformance of routing, evidence boundaries, references, commands,
   output contracts, and completion rules;
2. focused read-only behavioral canaries using committed miniature fixtures.

Do not claim that a case passed merely because its identifier appears in this
prompt.

Do not inspect `.github/scripts/run-claude-skill.mjs`, workflow gate tests, or
other grading internals that encode expected results. Derive every case outcome
from its task, fixture, skill instructions, and command evidence.

Read:

- `AGENTS.md`;
- every `plugins/shapelang/skills/*/SKILL.md`;
- every reference or script routed by those entrypoints;
- every `plugins/shapelang/skills/*/agents/openai.yaml`;
- `plugins/shapelang/skills/routing-cases.json`;
- `fixtures/skills/cases.json`;
- current CLI help for commands used by the cases.

## Static conformance

Evaluate exactly these checks:

- `shape-lang`: `mode-boundaries`, `draft-strict`, `current-cli`,
  `stable-refs`, `drift-review`.
- `shape-contract-preflight`: `baseline-separation`, `unknown-plan`,
  `decision-contract`, `current-cli`.
- `shape-contract-guard`: `impact-support-separation`,
  `semantic-normalization`, `source-boundary`, `structured-output`.
- `shape-index`: `explicit-only`, `clean-baseline`,
  `no-invariant-quota`, `ast-navigation`.
- `shape-review`: `code-first`, `all-incident-relations`,
  `false-positive-challenge`, `drift-separation`.

Return each static check as an object with its exact ID, `pass` or `fail`
status, and concrete evidence naming the instruction, metadata, reference, or
current CLI help that supports the result. An ID without evidence is not an
evaluation.

Fail static conformance when a skill:

- teaches a route or flag contradicted by v0.7.0;
- weakens strict checking, final forbids, guards, coverage, or bindings;
- treats generated or analyzer output as architecture truth;
- depends normatively on a sibling skill;
- invents effects, invariants, review evidence, or source behavior;
- conflicts with its metadata, reference, or structured output;
- routes adjacent work to the wrong shipped skill.

## Behavioral cases

Run every case assigned to each skill in `fixtures/skills/cases.json`. Inspect
the complete fixture and execute every listed required command. A command that
is expected to diagnose a failure may exit non-zero; capture that result rather
than skipping the case.

Treat each listed fixture path as an isolated miniature repository snapshot.
Outer-repository authored Shape or generated AST does not supply missing
fixture evidence.

Record the exact commands in the case result and cite concrete command output,
authored declarations, source behavior, and focused symbols in `evidence`.

Set a case to `fail` when the skill's instructions lead to another outcome,
when required evidence cannot be obtained, or when a required command was not
run. Add one release finding for every failed static check or behavioral case.

Return one result for each shipped skill. Overall status may be `pass` only when
all static checks and behavioral cases pass and `findings` is empty.

These read-only canaries are release smoke tests. They do not replace fresh
held-out forward tests of material skill changes on supported models.
