# parallel-work

A Claude Code plugin that picks the next GitHub issue which **won't collide** with
work already running in another worktree, claims it, and starts a session on it.

[한국어](README.ko.md)

## The problem

Claude Code already isolates parallel sessions: `claude --worktree <name>` creates
a worktree on its own branch and starts a session inside it. File collisions are
solved.

What isn't solved is the layer above — **deciding what to pick up.** Once three or
four sessions are running, you are the one remembering which is doing what. Sooner
or later two of them touch the same files, or one starts an issue another already
began.

This plugin owns that decision. It doesn't create worktrees; `claude --worktree`
already does.

## Install

```bash
claude plugin marketplace add do0ori/claude-parallel-work
claude plugin install parallel-work@do0ori
```

## Usage

From your main checkout:

```
/next-task
```

You don't have to remember the command. Ask in plain language — *"what's next?"*,
*"give me something that won't conflict"*, *"start another session in parallel"* —
and the skill picks it up. `/next-task` and `/work-issue` are just shortcuts into
it.

```
Picked: #29 SplashScreen renders outside SafeAreaProvider
  Why:      P1 · bug · frontend
  Overlap:  none
  Claimed:  assignee=you, Status=In Progress ✓

Opened a new session — worktree frontend/splash-safe-area, issue #29
```

The new session renames its branch to your repo's convention, installs what that
area needs, reads the issue with its comments, opens a draft PR, and starts work.

`/next-task --dry-run` shows the ranking and the reasoning without claiming
anything.

## How it decides

Everything hinges on one idea: an **area** — a coarse slice of the repository,
like `frontend`, `backend`, or `ai`.

- **An issue's area** comes from its labels.
- **A worktree's area** comes from the files it has actually touched. If it hasn't
  touched anything yet, the branch name is used as a guess.
- **An open PR's area** comes from its changed files. This is the only window into
  work happening on someone else's machine.

A candidate whose area is already occupied gets **demoted, not excluded.** If every
candidate overlaps, the tool says so and asks rather than picking blind.

Hard exclusions are separate: someone else is assigned, the Project status is in
the excluded list, or an in-flight worktree or PR is already linked to the issue.

An issue assigned to *you* is not excluded — it's marked `already claimed by you`
and sorted to the top, so work you reserved earlier gets finished first.

### Where the area map comes from

If your repo has an [`actions/labeler`](https://github.com/actions/labeler) config
(`.github/labeler.yaml`), it is read as-is. Using the same rules as your PR labeler
keeps "what the label says" and "what the overlap check says" from drifting apart.

**It is not required.** Without it, top-level directories become the areas —
`frontend/`, `backend/`, and so on — and the tool tells you that's what it did.

Label names are matched after **stripping everything but letters and digits and
lowercasing**, so `🖥️frontend`, `Front-End`, and the directory `frontend` all line
up. Naming issue labels after your directories is enough to make this work with no
labeler config at all.

An issue with no area-like label is shown as `no area label — cannot check overlap`.
It still gets ranked; you just have to judge the overlap yourself.

## Ranking

| # | Criterion |
| --- | --- |
| 1 | Already claimed by you — finish what you reserved |
| 2 | Priority — in the configured order, unset last |
| 3 | Overlap — overlapping candidates sort lower |
| 4 | Status — in the configured order |
| 5 | Labels — `bug` > `enhancement` > everything else |
| 6 | Issue number — older first |

## Claiming

There is no way to lock a GitHub issue atomically. If two people — or two sessions
— grab the same issue in the same moment, both end up assigned.

So the claim assigns you, **reads the issue back**, and only then moves the Project
status. If someone else is on it too, the claim exits non-zero before touching the
status, and the later arrival backs off. That read-back is what stands in for a lock.

This is not a team-only concern, and there is no "solo mode". The whole point of
this plugin is running several sessions at once, which means several actors even
when they're all you. An assignee alone can't tell "reserved" from "actively being
worked on" — that's what the status is for.

## Opening the new session

`launch` decides how:

| | |
| --- | --- |
| `print` (default) | Prints one command for you to paste |
| `session` | Opens a new window and starts the session in it |

`print` is the default because it works in every terminal on every OS, and it lets
you look at the choice before committing to it.

`session` writes a small shell script and hands it to a terminal. Passing the
command as terminal arguments breaks quietly on the quoting rules of whichever OS
you're on; going through a script avoids that entirely.

| OS | How |
| --- | --- |
| Windows | Windows Terminal (`wt`) if present, otherwise a new `cmd` window |
| macOS | `open -a Terminal` |
| Linux | `x-terminal-emulator`, `gnome-terminal`, `konsole`, or `xterm` |

If none fits, set `terminalCommand`. `{script}` becomes the file to run and `{dir}`
the repository root:

```json
"terminalCommand": ["wezterm", "start", "--cwd", "{dir}", "--", "{script}"]
```

If the window can't be opened, you get the paste-able command instead. It's never a
dead end.

## Open the draft PR first

This is the one habit the plugin asks of you: open the PR as a **draft when you
start**, with `Closes #<number>` in the body — not when you finish.

Local worktrees are visible only through `git worktree list`, which only knows about
your machine. And even for your own worktrees, which issue one belongs to is only
knowable through a linked PR. A draft PR closes both gaps at once — for teammates,
and for you three sessions from now.

It matters when working alone too. With no PR, a worktree shows up as `issue
unknown` and the issue it's working on stays in the candidate list.

## Configuration

**Try it with no configuration first.** `.claude/parallel-work.json` is optional. If
there's exactly one GitHub Project it's found automatically, areas come from the
labeler config or your directories, and everything else has a default. Anything the
tool couldn't determine is reported as a warning rather than silently assumed.

You need config when:

| Symptom | Set |
| --- | --- |
| Warning that several Projects were found | `projectNumber` |
| Your Priority/Status values are named differently | `priorityField` / `statusField` / `priorityOrder` / `statusOrder` |
| A fresh worktree fails to build for lack of dependencies | `setup` |
| You want new sessions to open their own window | `launch` |

You don't have to write it by hand either — ask it to *"set up parallel work for
this repo"* and it inspects the repository, proposes values, and asks you to confirm.

```json
{
    "projectNumber": 1,
    "priorityField": "Priority",
    "priorityOrder": ["P0", "P1", "P2"],
    "statusField": "Status",
    "statusOrder": ["Todo", "", "Backlog"],
    "excludeStatuses": ["In Progress", "Done"],
    "labelOrder": ["bug", "enhancement"],
    "areaSource": ".github/labeler.yaml",
    "claimStatus": "In Progress",
    "launch": "print",
    "setup": {
        "frontend": "npm install --prefix frontend",
        "ai": "pip install -r ai/requirements.txt"
    }
}
```

| Key | Meaning |
| --- | --- |
| `projectNumber` | GitHub Project number. Omit it and a single Project is found automatically |
| `priorityField` / `statusField` | Field names on the Project |
| `priorityOrder` / `statusOrder` | Earlier sorts first. `""` means the value is empty |
| `excludeStatuses` | Issues in these statuses are dropped from the candidates |
| `areaSource` | File to read the path-to-area map from |
| `claimStatus` | Status to move to when claiming. `null` leaves it alone |
| `launch` | `"print"` (default) or `"session"` |
| `terminalCommand` | Override how `session` opens a window |
| `setup` | Per-area setup commands. Only the areas you'll touch are run |

Write only the keys that differ from the defaults. Copying a default into your
config pins you to today's value after the default moves on.

### Carrying local files into new worktrees

A worktree is a fresh checkout, so gitignored files like `.env` aren't there. Put a
`.worktreeinclude` at the repository root and Claude Code copies them in:

```
frontend/.env
proxy/.env
```

**You do not have to write it yourself.** Just before opening a new session, the tool
looks for gitignored `.env`-style files that are not listed, adds them, and tells you
what it added:

```
Added to .worktreeinclude so the new worktree gets them: frontend/.env, proxy/.env
```

It is a file that gets committed, so the change is always reported rather than made
quietly.

## Requirements

`git`, an authenticated `gh`, and Node 18+. The scripts use **no external packages**
— they have to run in a fresh worktree that has no `node_modules` yet.

Windows, macOS, and Linux behave the same. A GitHub Project is optional; without one
the ranking falls back to overlap, labels, and issue number, and says so.

## What it deliberately doesn't do

- **Create worktrees.** `claude --worktree` already does.
- **Decide priority for you.** The Project's Priority field is the only source. If
  it's empty, the tool offers to fill it in — it doesn't invent values.
- **Pick blindly when everything overlaps.** It asks.

## One real limitation

**It cannot see other people's local worktrees.** Work that hasn't been pushed as a
PR is invisible to it. The draft-PR habit above is the only thing that closes this
gap, and it's a habit, not a feature.

## License

MIT
