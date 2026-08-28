---
description: Pick the next issue that will not collide with work already running, claim it, and start a session on it
argument-hint: "[--dry-run] [area]"
---

Run the **picking** flow of the `picking-parallel-work` skill.

Arguments: $ARGUMENTS

- No arguments — consider every candidate.
- An area name — only consider issues in that area.
- `--dry-run` — show the ranking and the reasoning, and **claim nothing.**

Do not decide alone. Present the top candidates with their reasoning as a choice,
mark the first one as recommended, and carry whatever gets chosen all the way
through: claim it, open the new session, and hand it the issue.

Skip the question only when the person already named an issue, or told you to just
pick. If every candidate overlaps with work in flight, show the list and stop.
