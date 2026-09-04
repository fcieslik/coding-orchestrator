# State snapshot is workflow truth

Each workflow run uses `state.json` as the authoritative current state and `history.jsonl` as an append-only operational audit. State-changing events share a monotonically increasing revision with the resulting snapshot; the snapshot is published first, so a crash may leave history one revision behind but can never make an uncommitted history event authoritative. This detectable gap is preferable to event sourcing or a transaction journal in V1, and automatic reconciliation is deferred to recovery work.
