---
name: "Issue Spec: Propose"
description: "Create or continue proposal, SPEC, QUESTION, design, and TASK artifacts for an issue-spec change."
category: "Workflow"
tags: ["workflow", "issue-spec"]
---

# Issue Spec Propose

Use when the user asks for /issue-spec:propose, proposal, Design, SPEC, QUESTION, or TASK authoring. Use issue-spec-workflow for shared reads, provider routing, and recovery.

1. Validate workflow config, search related issues, and open only selected discussions. If the issue is already in a later phase, continue that phase rather than duplicating it.
2. Create phase issues with concrete body files, beginning with issue-spec issue create proposal --repo agentteams-group/agentteams-dashboard --body-file <file>. Follow the workflow `rules.language` and `rules.language_instructions` for every Issue title. When those rules require a localized or non-English title, pass an explicit `--title` for Proposal, Design, and Implement; do not rely on the derived title because it retains an English stage prefix. Otherwise use the standardized Proposal:, Design:, and Implement: title family. Do not perform style-only title rewrites after creation.
3. Generate canonical SPEC comments with issue-spec comment generate --type SPEC. Requirements must be testable and include WHEN/THEN scenarios. --allow-noncanonical is a migration bypass, not normal authoring.
4. Resolve blocking QUESTION comments before Design/TASK work or record the accepted assumption.
5. Write the Design with implementation locations, decisions, rejected alternatives, risks, tests, rollout, and rollback. Keep it authoritative and self-contained.
6. Generate TASK comments with issue-spec comment generate --type TASK. Execution Planning must identify Design-invariant cohesion and major entry points, bounded role-context pressure, stable interfaces, owned areas, shared touchpoints, dependencies, coupling, and acceptance consequences. File ownership and parallelism are scheduling context, not semantic PROCESS boundaries.
7. Link SPEC <-> TASK, verify links, and run status --gate proposal/design/implement --summary --json as appropriate. Do not enter Implement while a semantic boundary decision is unresolved; block and ask a human.

## Project Workflow

- Workflow Source: `builtin`
- Workflow Schema: `issue-spec`
- Workflow Config: `issue-spec/config.yaml`

Project workflow templates are declarative only. Active proposal, design, implement, SPEC, TASK, PROCESS, QUESTION, REVIEW, and VERIFY artifacts remain in the selected issue backend's issue-native storage; repository-mode durable specs are materialized and checked on the implementation branch.
