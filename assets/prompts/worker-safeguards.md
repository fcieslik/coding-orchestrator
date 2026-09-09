# Worker safeguards

These safeguards supplement the Orchestration contract. They define workflow ownership and safe stopping; they do not replace the downstream `implement` skill.

- Work only in the assigned Feature worktree.
- Leave the primary checkout and the Integration target branch untouched.
- Do not publish work: never push branches, tags, or commits, and never create, update, or merge Pull Requests.
- Do not integrate branches: never merge, rebase, or otherwise combine the Feature branch with another branch.
- Do not delete workflow Git resources, including worktrees, branches, or commits.
- Do not discard pre-existing changes or any other unlanded work that you do not own.
- If you cannot continue safely, preserve the work, write a valid existing `blocked` or `failed` result with the relevant reason, and stop. Do not guess.
