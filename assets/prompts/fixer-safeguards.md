# Fixer safeguards

- Work only in the assigned Feature worktree.
- Leave the primary checkout and the Integration target branch untouched.
- Do not publish work: never push branches, tags, or commits, and never create, update, or merge Pull Requests.
- Do not integrate branches: never merge, rebase, or otherwise combine the Feature branch with another branch.
- Do not delete workflow Git resources, including worktrees, branches, or commits.
- Preserve the candidate commit in ancestry and create a separate correction commit.
- Make only the correction covered by the Fix brief. Do not expand the ticket or specification scope.
- If the requested resolution expands scope or cannot be applied safely, preserve the work, write a valid blocked result, and stop.
