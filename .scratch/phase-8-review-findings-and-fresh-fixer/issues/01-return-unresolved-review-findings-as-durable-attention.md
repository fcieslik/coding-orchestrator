# 01: Return unresolved review findings as durable attention

**What to build:** Let a Worker complete and commit its assigned implementation while returning bounded, structured findings from its internal review when those findings cannot be safely resolved without a decision. The Orchestrator validates the known candidate commit, closes the owned pane, persists Review attention, keeps the original ticket unresolved, and reports the implementation and smallest required decisions without advancing the Ticket queue.

**Blocked by:** None (can start immediately)

**Status:** completed

- [x] The Worker contract tells the Worker to fix clear findings inside the assigned ticket scope and to return unresolved decision-requiring findings rather than guess, ignore them, or expand scope.
- [x] The completed Worker result supports a bounded review outcome that distinguishes a clean review from structured unresolved Standards or Spec findings without adding undefined `medium` or `large` severities.
- [x] Existing valid completed results without review data remain compatible and follow the current accepted-ticket path.
- [x] A valid attention result identifies the assigned ticket, canonical candidate commit, concise findings, and smallest required decision for each finding.
- [x] The Orchestrator validates the candidate commit using the existing artifact, repository, worktree, branch, HEAD, ancestry, and cleanliness checks.
- [x] A valid candidate with unresolved findings becomes durable Review attention rather than an ambiguous side effect: the run is blocked from `implementing`, the ticket is not accepted, and later tickets remain unavailable.
- [x] State and Operational history preserve the candidate commit, originating Worker attempt, findings, and required decisions across Orchestrator restart.
- [x] Human and JSON output clearly report that implementation exists but acceptance requires a decision.
- [x] The original owned Worker pane is closed and cannot receive later prompts; full prompts, transcripts, and hidden reasoning are not persisted.
- [x] A finding that requires work outside the original ticket/specification scope tells the user to prepare separate work and never creates or appends a ticket automatically.
- [x] Public-process tests with fake Herdr and a real temporary Git repository prove both the clean accepted path and the candidate-with-attention path, including queue refusal and restart-safe reporting.
- [x] Runtime and generated schemas, glossary, prompt assets, and skill documentation describe the new evidence without moving review methodology into the Orchestrator.
