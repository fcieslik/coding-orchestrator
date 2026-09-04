# 03: Harden repo-local persistence and validation

**What to build:** Make creation and inspection fail closed at filesystem and data-integrity boundaries. A visible Workflow run is always complete, genuinely repo-local, schema-compatible, and internally coherent; crashes or corruption produce diagnostics without destructive repair.

**Blocked by:** 02: Add retry-safe creation and implicit run selection.

**Status:** completed

- [x] Minimal runtime bootstrap creates the runs area and preserves existing ignore content while ensuring runtime runs are effectively ignored by Git.
- [x] Bootstrap aborts before run creation if Git-ignore protection cannot be proven.
- [x] Repository and specification real paths are checked; specification symlinks escaping the Target repository are rejected.
- [x] Symlinked runtime directories, run directories, snapshots, history files, or lock locations are rejected before reading or writing.
- [x] Initial creation fully writes and synchronizes a uniquely owned hidden staging directory before atomically publishing the final run.
- [x] Creation never overwrites another run and cleans up only staging artifacts owned by the failing invocation.
- [x] Hidden staging directories left by other or interrupted invocations are never treated as runs or deleted automatically and are surfaced as diagnostics.
- [x] Snapshot replacement and logical history append use synchronized same-directory temporary files followed by atomic publication.
- [x] Every persisted snapshot and history record is runtime-validated on read; unsupported schema versions and unknown Run phase values fail closed.
- [x] Unknown additive object properties are structurally preserved rather than stripped during parsing and serialization.
- [x] History event types accept future namespaced values while retaining exact unknown event data.
- [x] History validation requires contiguous sequences, matching run identities, nondecreasing state revisions beginning at 1, increments of at most one, and no revision ahead of the snapshot.
- [x] A final history revision equal to snapshot revision is reported as synchronized.
- [x] History exactly one revision behind remains readable with a clear interrupted-audit warning.
- [x] Empty history, malformed or blank records, duplicate/out-of-order sequences, mismatched run IDs, history ahead of state, and larger revision gaps fail as corruption.
- [x] Explicit selection validates only its requested run; implicit selection refuses to skip any malformed candidate.
- [x] Corruption and incompatibility use exit status 4, identify the affected data, and preserve every original byte.
- [x] Injected filesystem failures at write, sync, and rename boundaries prove readers see only a complete old or complete new file and never a partial published run.
- [x] Public subprocess tests cover path containment, symlinks, Git-ignore behavior, audit warnings, corruption classes, and structured error output.
