# Docker Deployment

Memorix supports Docker as an **HTTP control-plane deployment path**.

This Docker flow is for:

- a long-lived `serve-http` control plane
- the dashboard on port `3211`
- IDEs and agents that connect over `http://host:3211/mcp`

It is **not** a containerized form of `memorix serve` (stdio MCP).

---

## Quick Start

From the repository root:

```bash
docker compose up --build -d
```

Then open:

- dashboard: `http://localhost:3211`
- MCP endpoint: `http://localhost:3211/mcp`
- health: `http://localhost:3211/health`

Stop it with:

```bash
docker compose down
```

The provided compose file:

- persists Memorix state in a named volume
- mounts the current repository at `/workspace`
- sets `MEMORIX_PROJECT_ROOT=/workspace`
- sets `MEMORIX_SESSION_TIMEOUT_MS=86400000` so long IDE HTTP sessions can remain idle for up to 24 hours

---

## One-Off docker run

If you prefer `docker run`:

```bash
docker build -t memorix:local .
docker run --rm -p 3211:3211 -v memorix-data:/data memorix:local
```

---

## Host Binding

`memorix serve-http` accepts a `--host` flag:

- **Local** (default): binds to `127.0.0.1` — only accessible from the host machine
- **Docker**: the Dockerfile sets `--host 0.0.0.0` — accessible from outside the container, which is required for port mapping (`-p 3211:3211`) to work

If you run `serve-http` manually inside a container, make sure to pass `--host 0.0.0.0` or the port will not be reachable from the host.

---

## What Docker Support Means

The official Docker artifacts in this repo provide:

- a multi-stage production image
- an example `compose.yaml`
- a healthchecked HTTP deployment

Docker support is for the **HTTP control plane**:

- `memorix serve-http`
- dashboard access
- HTTP MCP clients pointing at `http://localhost:3211/mcp`

It is not a promise that stdio MCP magically becomes container-friendly.

---

## Important Path Truth

Docker works best when Memorix can **see the repositories it is asked to bind**.

Project-scoped features such as:

- Git-root detection
- project binding
- project `memorix.yml`
- project `.env`
- Git Memory inspection

depend on the control plane being able to access the repository path.

### Good fit

- Docker Desktop on the same machine as your IDE
- a compose setup that mounts the repo you are working on into the container
- `memorix_session_start(projectRoot=...)` using a path visible **inside** the container

### Caveat

If an IDE on machine A sends `projectRoot=/Users/alice/code/app`, but the Docker container running on machine B cannot see that path, Memorix cannot perform project-scoped detection there.

In that case:

- HTTP connectivity still works
- global/shared memory still works
- but project-scoped Git/config semantics will not be fully available until the repo is mounted into the container at a visible path

This is a real runtime limitation, not just a documentation preference.

---

## Operations

Useful checks:

```bash
curl http://localhost:3211/health
curl http://localhost:3211/api/stats
docker compose logs -f memorix
docker compose ps
```

### HTTP session idle timeout

The HTTP MCP transport defaults to a 30-minute idle timeout. The example `compose.yaml` raises this to 24 hours for IDEs that keep one HTTP MCP session open while the user reads diffs, runs tests, or switches focus.

To change it:

```yaml
environment:
  MEMORIX_SESSION_TIMEOUT_MS: 86400000
```
