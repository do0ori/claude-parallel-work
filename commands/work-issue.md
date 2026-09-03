---
description: Start work on a given issue in this worktree — fix the branch name, set up the environment, read the issue, open a draft PR, and finish by rebasing onto the default branch
argument-hint: "<issue-number>"
---

Run the **starting work** flow of the `picking-parallel-work` skill.

Issue number: $ARGUMENTS

If no number was given, stop and say so rather than choosing one. This command is
for an issue that has already been decided on; picking one here would skip the
overlap check that `/next-task` performs.

When the setup steps are done, continue with the repository's normal development
workflow — then come back to the skill's **finishing** steps.

Two of those are easy to skip and cost the most when skipped:

- **Rebase onto the default branch before calling the PR ready.** It moves while
  you work, so a PR that never rebases went green on a stale base.
- **Do not merge.** A person decides that. Green checks are not a merge signal —
  a review may still be open, and with several branches in flight the merge order
  is a judgment call.
