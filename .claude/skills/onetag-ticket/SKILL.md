---
name: onetag-ticket
description: Execute OneTag tickets from the Linear backlog end to end — pick unblocked work, branch, implement, verify, and open a PR. Use when asked to work a ticket, pick up the next ticket or a batch of tickets, or when given one or more ONE-xx identifiers. Pass `batch` to take several related tickets in one PR.
argument-hint: "[ONE-xx ...] | batch [milestone or label]"
---

# Executing a OneTag ticket

Work is tracked in the Linear team **Onetag** (key `ONE`). Tickets are written to be
executed from zero context — the ticket plus the Working Agreement is everything you
need. If something is missing or contradicts the code, **comment on the ticket** rather
than guessing.

Read once, before starting: **OneTag — Working Agreement (read first)**
https://linear.app/onetag/document/onetag-working-agreement-read-first-a596e9467267

## Arguments

| Invocation | What it does |
| -- | -- |
| `/onetag-ticket` | One ticket: the next available one (step 1). |
| `/onetag-ticket ONE-12` | That ticket. |
| `/onetag-ticket batch` | A batch: as many related tickets as belong in one PR. See **Batch mode**. |
| `/onetag-ticket batch M5` or `batch area/tags` | A batch drawn only from that milestone or label. |
| `/onetag-ticket ONE-32 ONE-33 ONE-34` | Exactly those tickets, as a batch. |

Batch mode is how this repository is usually worked: the owner reviews and merges a batch
at a time. Steps 1–7 apply to every ticket in a batch; **Batch mode** says what changes.

## 1. Pick a ticket

If the user named one (`ONE-12`), use it. In batch mode, start here and then follow
**Batch mode** below. Otherwise find the next available one:

- List issues in team `Onetag` with label `agent-ready`, status `Todo` or `Backlog`
- **Discard anything with an unresolved `blockedBy`.** The graph is mostly a chain by
  design; starting blocked work means inventing the pieces that were supposed to come
  first, and those inventions are hard to unpick later.
- **An Urgent `type/bug` comes first, whatever milestone it is in.** Milestones sequence
  planned work. A bug found mid-flight sits wherever it was filed, and milestone order
  has no opinion about it — so ordering by milestone alone will happily schedule a
  cleanup chore ahead of a core flow that is completely broken.
- Otherwise prefer the lowest milestone (M0 before M1 before M2) and then the highest
  priority. Treat a ticket with no milestone as M0, and say so when you pick it — an
  unscheduled ticket is usually an oversight worth flagging.

Say which ticket you picked and why before you start.

## 2. Check the ticket type before touching anything

Look at the labels.

**`type/migration` — stop and read this.** These tickets change the production database
schema. The Supabase CLI in this working directory may be linked to the live project.

- Run migrations against a **local** stack (`supabase start`, `supabase db reset`),
  never against the linked remote.
- **Never run `supabase db push`.** Production is deployed by the
  `deploy-migrations` workflow when the PR merges, behind a required review.
- If the ticket cannot be verified locally, say so and stop rather than reaching for
  the remote.

Everything else proceeds normally.

## 3. Branch

Every Linear issue carries a `gitBranchName` (e.g. `tdhancock10/one-12-migrate-the-feed…`).
**Use it exactly.** Linear then links the branch and PR to the issue automatically, and
status largely maintains itself.

```
git checkout main && git pull
git checkout -b <gitBranchName from the issue>
```

Move the issue to **In Progress**.

## 4. Implement

The ticket's **Requirements** are the work. Its **Scope** section has an explicit
"Out" list — respect it.

- **Do not expand scope.** If you spot an unrelated problem, note it in a ticket
  comment or raise a new issue. Do not fix it here; a PR that does two things is
  harder to review and harder to revert.
- **Do not narrow scope either.** If a requirement turns out to be blocked, finish
  everything else and say plainly what you left and why.
- The "Files likely touched" list is a starting map, not a boundary.

Watch for these, which apply across the whole codebase:

- **Server data belongs in TanStack Query**, never in `AppContext`. AppContext holds
  only UI state no server owns.
- **No raw hex** outside `theme/tokens.ts`. CI enforces this for `theme/`, `lib/`,
  `features/` and `components/native/ui/`.
- **Auth user id and profile id are different things** after M3. Content is attributed
  to the *active profile*; storage upload paths stay keyed by the *auth user id*.
- **Use the product vocabulary** from the Working Agreement. Never "vendor" — it is
  Contributor. Never "favorite" or "bookmark" — it is Save.

## 5. Verify

Run the ticket's **Verify** block. Then walk its **Acceptance criteria** one by one and
confirm each actually holds — they are written to be mechanically checkable, so check
them rather than assuming.

```
npx tsc --noEmit && npm test
```

**If something fails, fix it.** Do not open a PR with a failing gate and a note
explaining the failure. CI runs the same checks and will block the merge anyway.

## 6. Record what you decided

Several tickets explicitly ask for a decision to be written back — ONE-15 ("state
which convention you chose"), ONE-20 ("state the finding for each"). Others will
surface judgement calls that the next agent needs to know about.

Before opening the PR, comment on the Linear issue with:

- Any deviation from the ticket, and why
- Any decision the ticket asked you to make and record
- Anything you found that should become its own ticket

This is the only channel between you and whoever picks up the next ticket. An
undocumented decision becomes an inconsistency three tickets later.

## 7. Commit and open the PR

**Never add attribution trailers.** No `Co-Authored-By: Claude`, no "Generated with
Claude Code" in the PR body, no AI attribution of any kind. Commits and PRs on this
repository are authored by the repository owner alone. This applies to amended and
squashed commits too.


Reference the issue in the description so Linear links them. Summarise what changed
and which acceptance criteria you verified.

Move the issue to **In Review**.

Report back to the user: the ticket, what you did, what you verified, anything you
deliberately left, and the PR link.

## Batch mode

One PR carrying several tickets that belong together — three or more, as many as make one
reviewable change (past batches ran four to nine). A good batch is one piece of work seen
from several tickets, not a pile of unrelated ones.

### Choosing the batch

1. **Anchor it on the ticket single-ticket mode would pick** — step 1's rules, restricted to
   the milestone or label if one was given. With ticket ids given, those are the batch;
   check their `blockedBy` and say if any is blocked by something outside it.
2. **Grow it along the work itself**, in this order:
   - tickets the anchor unblocks or is unblocked by — a chain (create → export → dashboard)
     is the best batch there is;
   - tickets blocked *only* by others in the batch — a close-out ticket lands with the
     tickets it waits on;
   - tickets in the same feature folder, screens or tables, where doing them apart means
     reading the same code twice.
3. **A small prerequisite from a lower milestone rides along** when the batch depends on
   it — a test-infrastructure fix the batch's new suites would otherwise inherit, say.
   It goes first.
4. **Leave out**, and say why:
   - anything that can't be finished here: it needs production credentials (EAS, the
     Apple Team ID, a signing fingerprint), a physical device, or a deployed environment;
   - a separate feature with its own migration and its own review surface;
   - a ticket that only shares a milestone with the rest.
5. **Migrations.** A batch may carry them; merging deploys them behind the required
   review. When the batch already has one, a small unrelated migration from the backlog
   may ride along, since its review is then paid once — but name it as such when you
   propose the batch.

Before starting, say in a few lines: the tickets, why they belong together, which one
anchors the batch, and what you considered and left out, and why.

### Working the batch

- **Branch** from an up-to-date `main`, using the **first** ticket's `gitBranchName` (first
  in commit order). The PR's `Closes ONE-x` lines link the rest.
- **Stacked work.** If this batch builds on a previous batch whose PR hasn't merged, branch
  from that branch but **do not open the PR** until the parent merges. Then
  `git rebase --onto origin/main <parent tip>`, re-run `npm run verify`, and open it
  against `main`. The owner squash-merges, so a PR stacked on an unmerged branch shows
  the parent's diff as new work, or is closed when the parent's branch is deleted. Only
  the PR waits — keep working and committing meanwhile.
- Move **every** ticket to **In Progress** at the start.
- **One commit per ticket**, in dependency order. Groundwork several tickets share (a data
  layer, a primitive) gets its own commit before them, titled without a ticket number
  and naming the tickets it serves.
- **Each commit stands on its own**: it typechecks, and its tests pass. When one file
  carries changes for two tickets, commit the first ticket's part, then the rest.
  **Check `git status` before every commit** — `git commit` takes everything already
  staged, not just the paths you added last.
- **Verify once for the whole batch** (`npm run verify`, plus `npm run db:test` if any
  migration changed), then walk **every** ticket's acceptance criteria.
- **Record per ticket**: one Linear comment on each, with its own decisions and deviations
  (step 6).
- **Follow-ups** found along the way become **new Linear issues** — in the right project,
  labelled, **without** `agent-ready` so the owner triages them — not only comment lines.
  Link each from the ticket that found it.

### The PR

- **Title:** a plain summary, then the tickets: `Create, export and manage Tags (ONE-32, 33, 34)`.
- **Body:**
  - a short paragraph on what the batch does;
  - a `Closes ONE-x` line per ticket;
  - a section per ticket, in commit order;
  - a **Verified** section;
  - a **Not verified here** list: anything needing a device or production.

  If the batch carries migrations, say so in bold near the top: merging deploys them.
- Move every ticket to **In Review**.

### Reporting back

Report the batch as a whole:

- the PR link;
- per ticket, what changed and what you verified;
- what you left out, and why;
- the follow-ups you filed.

Then, without being asked, **say which follow-ups and deferred items are worth folding into
this PR now** — cheap, related, and easier before the code ships than after — and which
should wait, with a one-line reason each. Add them only once the owner says so.

## When to stop and ask

Stop rather than improvising if:

- The ticket contradicts the code as it actually is
- A migration cannot be verified locally
- A requirement would need you to work around RLS rather than satisfy it
- The work turns out to depend on a ticket that has not landed

In each case, comment on the issue with what you found, and tell the user.
