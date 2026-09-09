# Require a live Herdr feasibility gate

Phase 3 is complete only when deterministic adapter tests pass against a fake Herdr executable and an explicit smoke command controls one real Codex lifecycle from inside Herdr. Mocks make malformed output and lifecycle failures reproducible, while the live gate proves pane ownership, cwd, opaque prompt delivery, waiting, output retrieval, and cleanup against the installed runtime; neither Herdr settlement nor mocked success is accepted as workflow completion.
