# Git Memory Guide

Git Memory is one of Memorix's core differentiators.

Instead of relying only on agent-written notes, Memorix can turn Git history into searchable engineering memory with source provenance.

---

## What Git Memory Stores

Each ingested commit becomes a memory with:

- `source='git'`
- `commitHash`
- title and narrative derived from commit metadata
- changed files
- inferred observation type
- extracted concepts and entities

This creates an engineering truth layer that complements reasoning memory and manual observations.

---

## Main Workflows

### Install automatic post-commit capture

```bash
memorix git-hook --force
```

This installs a `post-commit` hook that runs:

```bash
memorix ingest commit --auto
```

After that, new commits are automatically evaluated and stored as Git memories.

### Remove the hook

```bash
memorix git-hook-uninstall
```

### Ingest a single commit manually

```bash
memorix ingest commit
```

You can also target a specific ref:

```bash
memorix ingest commit --ref HEAD~3
```

### Batch ingest recent history

```bash
memorix ingest log --count 20
```

Use this when enabling Git Memory on an existing project and you want recent history backfilled.

---

## Noise Filtering

Not every commit deserves to become long-lived memory.

Memorix applies a Git noise filter before ingesting commits. Depending on commit content and your config, it may skip:

- merge commits
- trivial typo or formatting commits
- lockfile-only changes
- generated-only changes
- custom excluded patterns
- commit subjects matching configured noise keywords

If a commit is skipped in interactive mode, Memorix tells you why.

### Override the filter

If you really want to ingest a filtered commit:

```bash
memorix ingest commit --force
```

---

## Configuration

Configure Git Memory in `memorix.yml`:

```yml
git:
  autoHook: true
  ingestOnCommit: true
  maxDiffSize: 500
  skipMergeCommits: true
  excludePatterns:
    - "*.lock"
    - "dist/**"
  noiseKeywords:
    - "^BOT:"
    - "auto-deploy"
```

Key settings:

- `autoHook`: install the post-commit hook automatically on startup
- `ingestOnCommit`: ingest `HEAD` during post-commit execution
- `maxDiffSize`: cap how much diff content is included
- `skipMergeCommits`: skip merge commits by default
- `excludePatterns`: skip commits touching only matching files
- `noiseKeywords`: skip commits whose subjects match configured patterns

See [CONFIGURATION.md](CONFIGURATION.md) for the full configuration model.

---

## Retrieval Model

Git memories are especially useful for questions like:

- What changed recently?
- Which commit introduced this behavior?
- Which files were touched by this feature?
- When did we ship this fix?

Memorix retrieval is source-aware:

- “what changed” style questions boost Git memories
- “why did we do this” style questions boost reasoning memories
- “how did we fix this” style questions can use both

Git memory is not meant to replace reasoning memory. The strongest setup is:

- **Git Memory** for engineering truth
- **Reasoning Memory** for trade-offs, decisions, and intent

---

## Cross-Linking

Memorix can connect Git memories and reasoning memories through:

- shared entities
- explicit `relatedCommits`
- cross-references in detail views

This gives you a layered understanding:

- Git says what changed
- reasoning says why it changed

---

## Recommended Rollout

For a new project:

1. create `memorix.yml`
2. enable Git Memory config
3. install the git hook
4. optionally ingest recent history
5. start using reasoning memory alongside Git Memory

Suggested first run:

```bash
memorix init
memorix git-hook --force
memorix ingest log --count 20
```

---

## Troubleshooting

### The hook installed, but no memories appear

Check:

- you are inside a Git repository
- the hook file exists
- the commit was not filtered as noise
- the project identity is correct

Run:

```bash
memorix status
```

### A commit was skipped unexpectedly

Try:

```bash
memorix ingest commit --force
```

If that works, your noise filter settings are likely too aggressive.

### Worktree repositories

Memorix resolves the Git hooks directory in a worktree-safe way, so `.git` can be either:

- a directory
- or a `gitdir:` indirection file

---

## Related Docs

- [Configuration Guide](CONFIGURATION.md)
- [Setup Guide](SETUP.md)
- [Architecture](ARCHITECTURE.md)
