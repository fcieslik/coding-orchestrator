# Materialize tracker input as a local Workflow package

The execution engine accepts only a prepared local `spec.md` plus filename-ordered `issues/*.md`, copied into immutable run input. GitHub, Linear, or another tracker may feed a separate importer before execution and a separate write-back step afterward, but Workers and workflow semantics do not depend on tracker APIs; this keeps the POC deterministic and prevents delegated agents from discovering or selecting their own work.
