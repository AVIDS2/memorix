# Memorix Team Protocol

Rules for project-scoped multi-agent coordination via Memorix team tools. The Team page is a **project collaboration space** — it shows explicitly joined collaborators, open tasks, locks, messages, and what needs attention. It is NOT an organization backend, staffing admin tool, or automatic chat room between separate IDE windows.

Only agents that are intentionally participating in team/task/message/lock workflows need this protocol. Memory-only sessions should stay lightweight and do not need a team identity.

For real autonomous multi-agent development, prefer `memorix orchestrate`: it launches and supervises CLI agent workers through Memorix tasks, context, verification, and fix loops. The team tools support that workflow; they should not be interpreted as proof that unrelated IDE conversation windows can autonomously contact each other.

There are 4 team tools, each with an `action` parameter:

- `team_manage` — action: join / leave / status
- `team_file_lock` — action: lock / unlock / status
- `team_task` — action: create / claim / complete / list
- `team_message` — action: send / broadcast / inbox

## RULE 1: Start Lightweight, Join Team Explicitly

At the **beginning of every memory session**, before project-scoped memory work:

1. Call `memorix_session_start` to bind the project, open the session, and restore context.
2. By default, `memorix_session_start` is **lightweight**: it does **not** create a team identity.
3. If you actually want to participate in project collaboration, tasks, messages, or locks, explicitly join in one of two ways:
   - call `memorix_session_start` with `joinTeam: true`
   - or call `team_manage` with `action: "join"`
4. Store the returned **agent ID** only after an explicit join — you will need it for subsequent team operations.
5. Call `memorix_poll` with your agent ID to see current collaborators, check available tasks, and read unread messages.
6. If you need a custom role or capabilities, use explicit `team_manage(join)` so the role overrides the default mapping cleanly.

## RULE 2: Lock Before Edit

Before modifying any file that another agent might also be working on:

1. Call `team_file_lock` with `action: "status"` and the file path to check if it is already locked.
2. If unlocked, call `team_file_lock` with `action: "lock"`, the file path, and your agent ID.
3. If locked by another agent, **do not edit that file**. Either:
   - Work on a different file.
   - Send a `request` message to the lock owner asking them to release it.
   - Wait and re-check later.
4. When you are done editing, call `team_file_lock` with `action: "unlock"` to release the lock.

**Never edit a file locked by another agent.** Lock violations cause merge conflicts and data loss.

Locks auto-expire after 10 minutes. If you hold a lock for extended work, re-lock periodically to refresh the TTL.

## RULE 3: Use Tasks for Work Coordination

When the user assigns work that involves multiple agents or multiple steps:

1. Call `team_task` with `action: "create"` to break the work into discrete tasks with clear descriptions.
2. Use `deps` to declare dependencies between tasks (a task cannot be claimed until its dependencies are completed).
3. Call `team_task` with `action: "claim"` to assign a task to yourself before starting work on it.
4. Call `team_task` with `action: "complete"` and a `result` summary when the task is done.
5. Call `team_task` with `action: "list"` to see overall progress and find available work.

Rules:
- Only claim tasks whose dependencies are all completed.
- Only one agent may claim a given task.
- If you cannot complete a claimed task, leave the team so the task returns to pending and another agent can pick it up.

## RULE 4: Communication Protocol

Use `team_message` with `action: "send"` for direct messages and `action: "broadcast"` for announcements. Message types and their intended use:

| Type | Use |
|------|-----|
| `request` | Ask another agent to do something, release a lock, or provide information. |
| `response` | Reply to a prior request. |
| `info` | Share context: discoveries, status updates, warnings about tricky code. |
| `announcement` | Broadcast to all agents: major state changes, deployment events, breaking changes. |
| `contract` | Propose or agree on a division of work. Both agents should acknowledge. |
| `error` | Report a blocking issue that requires another agent's attention. |

Rules:
- `action: "send"` requires the full UUID of the target agent. Get it from `team_manage` with `action: "status"`.
- Check your inbox (`action: "inbox"`) at least once before starting new work and once before ending a session.
- Keep message content under 10KB. Be concise and actionable.

## RULE 5: Leave on Session End

When the session is ending:

1. Call `team_file_lock` with `action: "unlock"` for every file you have locked, or they will remain locked until TTL expiry (10 min).
2. If you have in-progress tasks you cannot finish, leave them — leaving releases your tasks back to pending.
3. Call `team_manage` with `action: "leave"` and your agent ID. This marks you inactive, releases all your locks, and clears your inbox.

## RULE 6: Conflict Prevention

- **Check before acting.** Always check team status and file lock status before starting work to understand the current state.
- **Communicate before diverging.** If you plan to refactor shared code, broadcast an `announcement` first so other agents can save their work.
- **Respect lock ownership.** The lock holder has exclusive write access. No exceptions.
- **Prefer small, scoped changes.** Large cross-cutting changes increase conflict risk. Coordinate via tasks and messages if a change touches files other agents are working on.
- **Do not duplicate work.** Check the task list before creating new tasks. If a similar task exists, claim it instead of creating a duplicate.

## Summary of Required Calls

| When | Tool Call |
|------|-----------|
| Session start | `memorix_session_start` (lightweight) |
| Join collaboration | `memorix_session_start(joinTeam=true)` or `team_manage(join)` |
| After joining | `memorix_poll` (check status + inbox) |
| Before editing a shared file | `team_file_lock(status)`, `team_file_lock(lock)` |
| After editing | `team_file_lock(unlock)` |
| Starting a unit of work | `team_task(claim)` or `team_task(create)` + `team_task(claim)` |
| Finishing a unit of work | `team_task(complete)` |
| Need to coordinate | `team_message(send)` or `team_message(broadcast)` |
| Session end | `team_file_lock(unlock)` (all), `team_manage(leave)` |
