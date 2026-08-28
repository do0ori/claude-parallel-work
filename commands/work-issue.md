---
description: Start work on a given issue in this worktree — fix the branch name, set up the environment, read the issue, open a draft PR
argument-hint: "<issue-number>"
---

Run the **starting work** flow of the `picking-parallel-work` skill.

Issue number: $ARGUMENTS

If no number was given, stop and say so rather than choosing one. This command is
for an issue that has already been decided on; picking one here would skip the
overlap check that `/next-task` performs.

When the flow is done, continue with the repository's normal development workflow.
