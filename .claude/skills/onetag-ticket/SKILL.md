---
name: onetag-ticket
description: Execute a OneTag ticket from the Linear backlog end to end — pick an unblocked ticket, branch, implement, verify, and open a PR. Use when asked to work a ticket, pick up the next ticket, or when given a ONE-xx identifier.
---

# Executing a OneTag ticket

Work is tracked in the Linear team **Onetag** (key `ONE`). Tickets are written to be
executed from zero context — the ticket plus the Working Agreement is everything you
need. If something is missing or contradicts the code, **comment on the ticket** rather
than guessing.

Read once, before starting: **OneTag — Working Agreement (read first)**
https://linear.app/onetag/document/onetag-working-agreement-read-first-a596e9467267

## 1. Pick a ticket

If the user named one (`ONE-12`), use it. Otherwise find the next available one:

- List issues in team `Onetag` with label `agent-ready`, status `Todo` or `Backlog`
- **Discard anything with an unresolved `blockedBy`.** The graph is mostly a chain by
  design; starting blocked work means inventing the pieces that were supposed to come
  first, and those inventions are hard to unpick later.
- Among what remains, prefer the lowest milestone (M0 before M1 before M2) and then the
  highest priority.

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

## When to stop and ask

Stop rather than improvising if:

- The ticket contradicts the code as it actually is
- A migration cannot be verified locally
- A requirement would need you to work around RLS rather than satisfy it
- The work turns out to depend on a ticket that has not landed

In each case, comment on the issue with what you found, and tell the user.
