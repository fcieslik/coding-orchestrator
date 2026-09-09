{{skillInvocation}}

Review the fixed implementation range:

BASE_SHA: {{baseSha}}
HEAD_SHA: {{headSha}}

Ticket: {{ticketReference}}
Spec: {{specReference}}

Orchestration contract:

- This is a review-only execution; do not modify implementation code.
- Review exactly the fixed `BASE_SHA..HEAD_SHA` range.
- Write the human-readable review to: {{reviewPath}}
- Write the machine-readable result to: {{resultPath}}
- Return pass/fail with structured findings.
- If required information is missing, write a `blocked` or `failed` review artifact instead of guessing.
