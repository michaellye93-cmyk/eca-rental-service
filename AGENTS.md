---
name: project-build-allocation
description: Ground rules for efficient model routing, implementation, testing, parallel work, escalation, and verification.
---

# AGENTS.md — Project Build Ground Rules

> The Phase / feature specification defines **what to build**.
> This file defines **how to execute it efficiently and safely**.

## 1. Core Principle

Use the **shortest safe execution path**.

Route work by the **cost of being wrong**, not by model prestige.

- **Luna** → mechanical collection, search, extraction, formatting, repetitive checks.
- **Terra** → normal engineering, investigation, implementation, testing, routine fixes.
- **Astra** → consequential decisions, architecture, ambiguity, coordination, escalation, final verification.

**Astra should not touch every token. Astra should touch every important decision.**

The 20/80 concept is directional, not a quota. Skip unnecessary layers.

## 2. Source of Truth

Priority:

1. Approved Phase / feature specification
2. This `AGENTS.md`
3. Existing architecture and project conventions
4. Agent judgment inside assigned scope

Do not expand scope, add unrequested features, redesign unrelated flows, refactor unrelated code, or change approved business behavior for convenience.

If the specification materially conflicts with the existing system, escalate.

# 3. Choose an Execution Mode First

## Mode A — Small / Clearly Scoped Change

Examples: text or styling fix, isolated validation, one export field/column, simple bug, small component change.

Default flow:

```text
Terra Builder
→ implement
→ targeted verification
→ independent review if useful
→ done
```

Use Luna only if discovery is needed. Use Astra only if the change reveals meaningful ambiguity, risk, or cross-system impact.

## Mode B — Standard Feature

Examples: normal workflow enhancement, new component, API enhancement, report, ordinary business logic.

Default flow:

```text
Terra investigates
→ Terra implements
→ targeted test/fix
→ integration check
→ Astra review only when risk/complexity warrants it
```

The same Terra agent should normally investigate and implement. Create a separate analyst only when several builders need one shared technical assessment.

## Mode C — Complex / High-Risk Feature

Examples: payment logic, authentication/authorization, sensitive data, schema migration, major workflow redesign, several dependent modules, several parallel builders.

Default flow:

```text
Luna Scout if useful
→ Terra analysis
→ Astra decisions/contracts
→ Terra builders
→ targeted tests
→ integration
→ Astra final verification
```

Do not force this full pipeline on small work.

# 4. Model Roles

## Luna — Scout / Mechanical Worker

Use for locating files/routes/tables/functions/tests, finding call sites and dependencies, extracting types/interfaces, inventories, log/test summaries, repetitive comparisons, formatting, and other mechanical tasks.

Return facts, not architecture. Do not invent missing requirements or redesign the system.

## Terra — Investigator / Builder

Terra performs most normal engineering: scoped investigation, frontend/backend implementation, forms, validation, CRUD, API/UI wiring, business logic with established rules, tests, routine debugging, and required local refactors.

Default rule: **investigate and implement in the same Terra task when practical.**

Do not create an Analyst → Builder handoff unless it adds clear value.

## Astra — Lead Engineer / Verifier

Use Astra when one bad decision can affect multiple downstream tasks.

Use for architecture, subsystem boundaries, shared contracts/interfaces, dependency sequencing, schema and risky migrations, security/privacy/payment decisions, conflicting or ambiguous requirements, cross-agent conflicts, difficult unresolved failures, integration judgment, and final verification of consequential work.

Astra should receive compressed findings where possible instead of repeating repository discovery.

# 5. Model Routing Is a Default, Not a Restriction

Model roles are preferred routing rules, not capability limits.

If the preferred model is unavailable, unsuitable, or repeatedly struggling:

- use another available capable model;
- keep the same task boundaries and verification requirements;
- briefly note only material routing changes.

Do not delay useful work merely to preserve model purity.

# 6. Parallel Agent Rule

Parallelize only work that is genuinely independent.

A task may run in parallel when it:

- does not depend on unfinished output from another active task;
- does not edit the same files;
- does not independently redefine a shared interface;
- does not share mutable migration/database state;
- can be verified independently.

Default maximum: **3 concurrent implementation agents**.

Dependencies override parallelism.

### Good

```text
Builder A → independent backend module
Builder B → independent frontend module
Builder C → independent tests/tooling
```

### Bad

```text
Builder A → design schema
Builder B → API using unfinished schema
Builder C → UI guessing unfinished API
```

# 7. File Ownership

Before parallel implementation, assign ownership.

Example:

```text
Builder A → src/payments/**
Builder B → src/components/payments/**
Builder C → tests/payments/**
```

Rules: one active owner per file; do not edit another builder's owned files; shared files get one designated owner; route shared-file changes through that owner/coordinator.

# 8. Context Reuse

Do not rebuild the same context for every agent.

A subagent should receive only the exact task, relevant requirement excerpt, relevant files, established interfaces/schema, constraints, acceptance criteria, and verification target.

Do not automatically send the full Phase document, full project history, unrelated screenshots, huge logs, or the whole repository.

If another agent already found the relevant facts, reuse them.

**No duplicate discovery.**

# 9. Repository Reading Rule

Use the smallest useful context.

Preferred sequence:

1. search exact symbol / route / table / component;
2. open the smallest relevant section;
3. inspect direct dependencies;
4. inspect relevant tests;
5. expand only when evidence requires it.

Do not repeatedly reread unchanged files.

Before a large read/search ask:

> Will this materially change the implementation decision?

If no, skip it.

# 10. Preserve Existing Behavior

For additive or narrowly scoped changes, existing behavior is presumed intentional unless the specification explicitly changes it.

```text
Existing output: A B C D
Requested: add E
Expected: A B C D E
Not:      A B C' D E
```

Before completion, explicitly verify that unrelated existing outputs and behavior remain unchanged where practical.

Do not silently change data sources, formulas, business rules, field meanings, layouts, API contracts, or existing calculations unless required by the specification.

# 11. Immediate Test Loop

Every implementation unit follows:

```text
implement
→ targeted verification
→ fix
→ targeted retest
```

Use the smallest check that proves the change. Do not run the full suite after every small edit.

After integration:

1. review combined changes;
2. verify shared contracts;
3. run relevant integration tests;
4. run required build/typecheck/lint;
5. run broader verification when justified.

# 12. Verify the User's Actual Result

Passing an internal test is not always proof that the delivered artifact works.

Verification should match the user's expected outcome.

```text
Excel / spreadsheet
→ validate generated workbook with an independent reader
→ verify formulas/values/format where practical

PDF
→ render and inspect output pages

UI
→ verify rendered interface and workflow

API
→ verify actual response contract

Database migration
→ verify resulting schema/data

Calculation/report
→ independently recompute representative values
```

Where practical, use an independent reader, renderer, test harness, or target application.

If target-application verification was not possible, state that limitation clearly.

# 13. Failure / Escalation Rule

Do not count every diagnostic command as a failed attempt.

Escalate when **the same approach fails twice without meaningful new evidence**.

Successful checks and tests of distinct hypotheses do not consume a failure budget.

Escalate immediately when requirements become ambiguous, a shared contract must change, work unexpectedly crosses subsystem boundaries, meaningful security/payment/data risk appears, agents disagree, scope must materially expand, or a local failure appears systemic.

Preferred escalation:

```text
Luna → Terra → Astra
```

# 14. Blockers Are Scoped

A blocker should pause only the affected workstream.

If one external service, credential, file, or dependency is unavailable:

- pause the affected task;
- continue independent work that remains useful, authorized, and safe.

Stop the entire execution only when the blocker prevents meaningful integration, verification, or completion of the overall task.

# 15. Change Discipline

Prefer the smallest correct change, existing patterns/utilities/components, focused diffs, and compatible interfaces.

Avoid unrelated refactoring, speculative abstractions, unnecessary dependencies, duplicate helpers, or cosmetic rewrites mixed with feature work.

The feature task is not a general cleanup exercise.

# 16. Phase Sequencing

Do not run dependent phases blindly in parallel.

If Phase 2 depends on Phase 1:

```text
Phase 1
→ integrate
→ verify
→ Phase 2
```

Parallelism should mainly happen inside a phase after dependencies are known.

# 17. Subagent Handoff

Keep handoffs compact:

```text
Status: completed | blocked
Changed: relevant paths
Verified: check → result
Issue: only if non-obvious
Escalation: none | concise reason
```

Do not return full source files, repeated specifications, huge logs, or long narratives.

# 18. Astra Coordination and Final Confirmation

Astra remains the **primary coordinator and final confirmer for every task**.

The depth of Astra review depends on task risk.

## Small / Standard Tasks

For small and standard tasks, Astra performs a **brief final confirmation** based on:

- the requested outcome;
- the worker's changed files/result;
- verification evidence;
- preservation of existing behavior where relevant;
- any stated limitations or unresolved risks.

Astra must **not repeat the worker's investigation, repository discovery, or tests without a specific reason**.

A specific reason includes:

- verification evidence is missing, contradictory, or weak;
- the result does not clearly satisfy the request;
- an unexpected change appears in the diff/output;
- regression risk is material;
- the worker reports uncertainty;
- the task has become more consequential than originally classified.

A single delegated worker does **not** by itself trigger a full independent Astra review.

## Complex / High-Risk / Multi-Workstream Tasks

Independent Astra verification is required when the task involves:

- complex architecture;
- high-risk business logic;
- security, privacy, payment, or sensitive data;
- meaningful schema/data migration;
- multiple implementation workstreams that must integrate;
- shared contracts/interfaces changed across modules;
- significant regression or production risk.

For these tasks Astra independently verifies the consequential parts of the result, including as applicable:

- acceptance criteria;
- cross-workstream integration;
- shared contracts;
- schema/migrations;
- sensitive logic;
- user-facing output;
- relevant integration/build/typecheck/lint results;
- preservation of required existing behavior;
- unresolved conflicts or out-of-scope changes.

Astra should focus on **expensive mistakes and integration risk**, not duplicate successful routine work.

# 19. Human Approval Gate

Do not interrupt the user for routine engineering choices.

Request approval before destructive production/database actions, irreversible migrations, deletion of user/business data, material business-rule changes not already specified, new billing/security/privacy consequences, or deployment with significant unresolved risk.

Prepare everything else autonomously.

# 20. Completion Report

Keep the final report concise:

```text
Completed:
- major outcomes

Changed:
- affected areas

Verified:
- targeted / integration / artifact checks

Preservation:
- existing behavior preserved | intentional changes listed

Limitations:
- none | target-application verification not performed / other real limitation

Remaining risk:
- none | actual unresolved risk
```

Do not repeat the full Phase specification.

# Master Execution Policy

When an approved specification is supplied:

> Execute the specification as the source of truth.
>
> First choose the shortest safe execution mode: Small, Standard, or Complex.
>
> Use Luna for mechanical collection and repetitive work.
>
> Use Terra for most investigation, implementation, testing, and routine fixes.
>
> Astra remains the primary coordinator and provides final confirmation for every task.
>
> For small and standard tasks, Astra reviews the result and verification evidence briefly and must not repeat investigation or tests without a specific reason.
>
> For complex, high-risk, or multi-workstream integration tasks, Astra performs independent verification of the consequential parts.
>
> Model roles are defaults, not restrictions.
>
> Reuse context and avoid duplicate discovery.
>
> Parallelize only independent tasks with explicit file ownership.
>
> Preserve existing behavior unless the specification explicitly changes it.
>
> Verify the user's actual result, not only internal implementation state.
>
> Escalate after two failures of the same approach without meaningful new evidence.
>
> Pause only blocked workstreams; continue useful independent work.
>
> Continue autonomously until acceptance criteria are satisfied or a true decision/blocker requires human input.

# Operating Summary

**Small work stays small.**

**Terra normally investigates and builds.**

**Luna handles mechanical volume.**

**Astra coordinates every task, confirms every result, and independently verifies consequential work.**

**Parallelism follows dependencies.**

**Context is reused, not rebuilt.**

**Existing behavior is preserved unless intentionally changed.**

**Verification follows the user's real outcome.**

**Optimize for cost per accepted result.**
