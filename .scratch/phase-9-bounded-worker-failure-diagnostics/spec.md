# Phase 9 — bounded Worker failure diagnostics

**Status:** completed

## Problem Statement

When a Worker attempt fails technically, the Orchestrator often reports only that the Workflow run is `blocked`. Useful evidence already returned by Herdr—such as the failed operation, process exit code, and bounded output—can be lost before it reaches the durable Execution record. This is especially confusing when `herdr agent start` fails after an attempt has begun but before a complete owned-agent handle exists.

The user needs a concise explanation of why the ticket stopped and a durable place to inspect the relevant evidence. Better diagnostics must not become a new logging subsystem, change retry behavior, or mix technical failures with unresolved code-review findings.

## Solution

Extend the existing Execution record with one bounded structured Attempt failure diagnostic. Persist the Execution record before the first Herdr operation, then update that same record if any technical part of Worker execution fails.

The diagnostic records the failed operation, concise message, optional process outcome, and bounded tails of stdout and stderr. The Workflow run becomes `blocked`, the Worker attempt becomes `failed`, and the ticket remains unaccepted. Existing state and history retain only a short failure reason and the existing reference to the Execution record.

The CLI reports that the ticket was blocked because a named operation failed, includes at most one short stderr line, and points to the Execution record for details. Review attention remains a separate outcome for a Worker that completed implementation and deliberately reported unresolved findings.

## User Stories

1. As a user, I want to know why a ticket was blocked, so that I can decide what to fix before retrying.
2. As a user, I want the failed operation named explicitly, so that I can distinguish pane creation, agent startup, waiting, result reading, and result validation failures.
3. As a user, I want to see a process exit code when one exists, so that a generic blocked status does not hide a concrete command failure.
4. As a user, I want a concise relevant stderr line in the CLI response, so that common failures are understandable without opening an artifact.
5. As a user, I want a path to the durable Execution record, so that I can inspect additional bounded evidence when needed.
6. As a user, I want diagnostics to survive restarting the Orchestrator, so that recovery does not depend on terminal history.
7. As a user, I want a failed Worker attempt to leave the ticket unaccepted, so that technical failure cannot become false implementation success.
8. As a user, I want explicit retry behavior to remain unchanged, so that improved reporting cannot unexpectedly duplicate work.
9. As an Orchestrator, I want an Execution record to exist before invoking Herdr, so that an early launch failure still has a durable diagnostic destination.
10. As an Orchestrator, I want to avoid launching a pane or Worker if the initial Execution record cannot be written, so that external work never starts without durable ownership.
11. As an Orchestrator, I want to preserve stdout and stderr returned by a failed Herdr command, so that transport evidence is not discarded while converting the error.
12. As an Orchestrator, I want process signal information preserved when available, so that termination can be distinguished from an ordinary non-zero exit.
13. As an Orchestrator, I want technical errors without process information represented by the same diagnostic shape, so that absent fields do not require another failure model.
14. As an Orchestrator, I want the Worker attempt marked `failed` and the Workflow run marked `blocked`, so that process outcome and recoverable workflow state remain distinct.
15. As an Orchestrator, I want the Operational history to contain a short failure reason, so that a run timeline explains why it stopped.
16. As an Orchestrator, I want the State snapshot's last execution reference to contain the same short reason, so that status inspection does not need to replay history.
17. As an Orchestrator, I want a primary execution failure kept separate from a later pane-cleanup failure, so that the original cause is not overwritten.
18. As a maintainer, I want diagnostic output bounded, so that one failed process cannot inflate durable run state without limit.
19. As a maintainer, I want only the tails of process streams retained, so that the section most likely to contain the final error is preserved.
20. As a maintainer, I want the existing Execution record and history mechanisms reused, so that this improvement does not introduce a new log or artifact type.
21. As a maintainer, I want the schema change to remain additive and optional, so that existing version 1 records continue to validate.
22. As a maintainer, I want prompts, environment variables, unsanitized arguments, and full transcripts excluded, so that diagnostics remain narrow.
23. As a maintainer, I want review findings kept separate from technical failure diagnostics, so that a completed candidate implementation is not confused with a failed launch or transport operation.
24. As a maintainer, I want one public regression seam, so that the POC gains confidence without a large test matrix or new test-only abstractions.

## Implementation Decisions

- Reuse the existing Execution record. Do not introduce a separate diagnostic file, event stream, logger, error registry, or observability subsystem.
- Persist the initial Execution record before the first Herdr operation. If this write fails, stop immediately, launch nothing, and return a normal CLI error because no Worker attempt was safely started.
- Extend the existing optional diagnostics object with a failed operation, concise message, nullable or optional exit code and signal, stdout, stderr, and one truncation flag. Fields unavailable for a particular failure remain absent or null rather than requiring another variant.
- Preserve the final 16 KiB of stdout and the final 16 KiB of stderr independently. The combined retained process output is therefore at most 32 KiB. Set `truncated` when either original stream exceeded its bound.
- Carry stdout and signal through Herdr invocation errors in addition to the operation, exit code, and stderr already exposed. Do not copy arbitrary error details into the Execution record.
- Use the same diagnostic shape for later technical Worker failures where possible. Operation and message identify the failed stage; process-specific fields are optional.
- Preserve the primary technical failure in diagnostics. If owned-pane cleanup also fails, retain that secondary failure in the existing cleanup error field instead of building a collection or cause chain.
- A technical failure marks the Worker attempt `failed`, blocks the Workflow run, and leaves the ticket unaccepted. Retain the existing resumable ticket and reconciliation semantics.
- Extend the existing last-execution reference with an optional short failure reason. Record the same reason in the ticket-blocked history event while continuing to use the existing record path as the diagnostic reference.
- Construct a deterministic human-readable CLI explanation containing the ticket ID, failed operation/message, exit code when available, at most 300 characters from the first non-empty stderr line, and the Execution-record path. Normalize the excerpt to one line and do not print the full retained streams.
- Do not add automatic retry. A later retry remains an explicit user action governed by the existing reconciliation and attempt limits.
- Do not add automatic secret detection or redaction to captured process streams in this POC. Continue to exclude the full prompt, environment variables, unsanitized command arguments, and full terminal transcript from durable diagnostics.
- Keep Execution-record schema version 1 because all new fields are optional and additive. Existing records without diagnostics or a failure reason remain valid.
- Keep Attempt failure diagnostics independent from Review attention. A technical failure explains why an execution contract was not completed; Review attention describes unresolved findings returned by a technically completed Worker with a Candidate commit.
- Update the installed skill and user-facing workflow documentation only enough to explain the durable reason and diagnostic path. Do not teach users internal recovery commands or expose implementation mechanics unnecessarily.
- Do not create a new ADR. This change follows the existing Execution-record and durable-evidence architecture and does not introduce a hard-to-reverse boundary.

## Testing Decisions

- Use one existing public-process seam: invoke `flow orchestrate` against a real temporary Git repository with an injected fake Herdr executable whose `agent start` operation fails.
- Make the fake failure return a non-zero exit, signal when supported, and stdout/stderr larger than their bounds. Assert externally observable files and CLI output rather than private helper calls.
- Assert that the Execution record was created before launch and ends as `failed` with the operation, message, process outcome, bounded stream tails, and truncation marker.
- Assert that the Workflow run ends `blocked`, the ticket is not accepted, the last-execution reference contains the short reason and record path, and Operational history records the same reason.
- Assert that human-readable CLI output uses the “ticket blocked because” form, contains no more than the short stderr excerpt, points to the Execution record, and does not emit the complete retained output.
- Keep these assertions in the public seam rather than adding direct tests for the failure-recording helper. Existing Herdr tests remain responsible for their current timeout, disappearance, malformed-response, and cleanup coverage.
- Run the full existing test, schema, typecheck, lint, format, and build gates after the focused regression passes. No real Herdr agent is required for the automated gate.

## Out of Scope

- A new logging, tracing, metrics, telemetry, or observability subsystem.
- A separate diagnostic artifact or complete Worker transcript.
- Unlimited stdout or stderr retention.
- Persisting the Worker prompt, environment variables, unsanitized argv, or hidden reasoning.
- Automatic detection or redaction of secrets inside local process output.
- A hierarchy, array, or recursive chain of failure causes.
- A comprehensive error-code or operation taxonomy.
- Automatic retry, changed attempt limits, or changed reconciliation policy.
- Changing the meaning of Worker result statuses or adding another Worker status.
- Changing Review attention, Review finding, Candidate commit, or fresh Fixer behavior.
- Adding support for another coding-agent executable.
- Expanding the automated suite into a full failure matrix already covered by lower-level Herdr tests.

## Further Notes

- Herdr already captures stdout, stderr, exit code, and signal at the command-runner boundary. The current gap is carrying this bounded evidence into the durable Worker attempt after an invocation error.
- The most important early-failure scenario is `herdr agent start` returning before a complete owned-agent handle exists. The prewritten Execution record supplies the durable anchor even when no successful launch callback occurs.
- “Worker attempt failed” and “Workflow run blocked” are deliberately different statements: the first describes a technical execution outcome, while the second says that user-controlled workflow progression has stopped safely.
- Better diagnostics should shorten the user's path to the next action; they must not make terminal output a second workflow protocol.

## Completion evidence

Completed on 2026-09-14. All 166 automated tests and the lint, typecheck, format, schema, and build gates passed. Live run `run_20260914T133659Z_abc670766af9` then proved a controlled real-Herdr `agent start` failure is persisted in the Execution record, reported concisely to the user, blocks the run without accepting the ticket, and closes the owned pane. Detailed evidence is recorded in the [Phase 9 ticket](issues/01-preserve-and-report-bounded-worker-failure-diagnostics.md#gate-evidence).
