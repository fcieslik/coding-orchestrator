# Coding Workflow Orchestrator

This context defines the language used to describe the orchestrator and its packaged skill.

## Language

**Development repository**:
The Git repository containing the orchestrator's source code, tests, and packaging machinery.
_Avoid_: Installed skill, skill directory

**Installed skill**:
An explicitly built snapshot of the orchestrator copied from the development repository into an agent's skill directory.
_Avoid_: Development repository, live checkout
