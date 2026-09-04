# Persist Git intent before preparation and Git removal before cleanup state

Phase 2 records a complete Git preparation plan in the authoritative State snapshot before creating its branch and Feature worktree, allowing only an exact retry to finish an interrupted operation. Cleanup removes and verifies the Feature worktree before recording its removed status, preserving the branch and refusing forceful or ambiguous recovery; this ordering keeps Git side effects and durable workflow truth fail-closed across crashes.
