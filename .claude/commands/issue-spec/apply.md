---
name: "Issue Spec: Apply"
description: "Implement PROCESS comments for an issue-spec change and keep implementation-change traceability synchronized."
category: "Workflow"
tags: ["workflow", "issue-spec"]
---

# Issue Spec Apply

Coordinator: complete DAG planning, workspace lifecycle, integration, links, review, recovery, and final evidence by following the backend-appropriate routing in issue-spec-workflow. Run the authoritative final sync by following issue-spec-review. After that sync, explicitly link the REVIEW to its review PROCESS, every covered change-bearing PROCESS, and every covered active SPEC. Follow issue-spec-workflow for the backend-appropriate rationale command. Each owning worker authors its own rationale under that worker's --agent. Do not copy that policy into a worker packet and do not implement a managed node inline.

## Implementation Role Packet

1. Accept only the sealed implementation assignment for the exact PROCESS, base revision, worktree, write ownership, focused tests, generators, result schema, and design_context. Do not load proposal bodies, the complete DAG, link matrices, post-merge policy, provider routing, or unrelated artifacts.
2. Before code changes, require design_context.read_mode=complete-issue-body and conflict_policy=design-authoritative-stop. Read the complete Design with issue-spec read issue --repo agentteams-group/agentteams-dashboard --issue <design_context.source_url> without comments, timeline, history, or gates. Stop and report any conflict; do not reinterpret or summarize the packet.
3. Work only in the assigned worktree and owned paths. Preserve the named invariant, decisions, must_preserve, must_not, and minimum_verification exactly. Do not collect or pass runtime-specific session IDs.
4. Implement the owned invariant, run the assigned generators exactly, and run focused verification. If the assignment cannot fit a bounded end-to-end working set, stop with the concrete stable-interface split options and acceptance consequences; do not split by path, command, finding, or token formula.
5. Produce exactly one DCO commit when required. Return only the result commit, changed paths, generator outputs, focused test results, decisions, risks, and bounded handoff/result receipt. Do not integrate, clean up, publish Coordinator artifacts, review your own code, or create final rationale before independent review converges.

## Project Workflow

- Workflow Source: `builtin`
- Workflow Schema: `issue-spec`
- Workflow Config: `issue-spec/config.yaml`

Project workflow templates are declarative only. Active proposal, design, implement, SPEC, TASK, PROCESS, QUESTION, REVIEW, and VERIFY artifacts remain in the selected issue backend's issue-native storage; repository-mode durable specs are materialized and checked on the implementation branch.
