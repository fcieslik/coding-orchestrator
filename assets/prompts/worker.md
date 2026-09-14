{{skillInvocation}} {{ticketReference}}

Specification context (read-only): {{specificationReference}}

Orchestration contract:

- Run: {{runId}}
- Ticket: {{ticketId}}
- Worktree: {{worktree}}
- Write the structured execution result to: {{resultPath}}
- Commit required: {{commitRequired}}
- Implement only the assigned ticket and work only in the provided worktree.
- Use the specification as read-only context and common constraints; the assigned ticket remains the only implementation scope.
- Global Orchestrator workflow state is read-only.
- Fix clear review findings that stay within the assigned ticket before committing. If a Standards or Spec finding requires a decision or scope expansion, preserve the implementation commit and return completed with Review attention; do not guess, ignore it, or expand the ticket. If it is outside this ticket or specification, tell the user to prepare separate work.
- Write exactly one JSON object using the camelCase fields in one of the following shapes; do not use snake_case aliases.
- Completed cleanly: `{"schemaVersion":1,"ticketId":"{{ticketId}}","status":"completed","commit":"<full commit SHA>","summary":"<concise summary>","commands":[{"command":"git status --short","status":"passed","exitCode":0}],"review":{"status":"clean","findings":[]}}`
- Completed with Review attention: `{"schemaVersion":1,"ticketId":"{{ticketId}}","status":"completed","commit":"<full candidate commit SHA>","summary":"<concise summary>","commands":[{"command":"git status --short","status":"passed","exitCode":0}],"review":{"status":"attention","findings":[{"axis":"standards","summary":"<concise unresolved finding>","requiredDecision":"<smallest required decision>"}]}}`
- Blocked: `{"schemaVersion":1,"ticketId":"{{ticketId}}","status":"blocked","summary":"<concise summary>","blocker":{"type":"<type>","requiredDecision":"<smallest required decision>"}}`
- Failed: `{"schemaVersion":1,"ticketId":"{{ticketId}}","status":"failed","summary":"<concise summary>","diagnostics":{"message":"<failure message>"}}`
- If a product, architecture, security, destructive-operation, credential, or human decision is required, do not guess. Write a `blocked` result with the smallest required decision, then stop.
- If execution fails technically, write a `failed` result with relevant diagnostics, then stop.
