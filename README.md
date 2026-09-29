# Lume CRM — A Complete Blueprint for Building a CRM Admin with Lume

English | [简体中文](README.zh.md)

> **This project set out to prove one thing: a back-office system (CRM-style) can be built entirely with Lume.**
> From database to REST API to LLM agent to the frontend shell, the server side contains
> not a single line of any other language — one C11 single binary `lume` plus one `.lume`
> script powers a complete customer/deal/activity management admin. This is not a "Lume
> toy": it is a runnable blueprint with a real data model, real business rules and an
> LLM-agent chat UI — copy it as the starting point for your next internal system.

## What it demonstrates about Lume as a backend

| Back-office concern | Provided by Lume in this project | Files |
|---|---|---|
| Database | Native `sql_query` (physically read-only) / `sql_write` (guarded writes), parameter binding everywhere to rule out injection | `src/db.lume` |
| Domain model | Customer / deal / activity tables + cascading delete + automatic audit trail on pipeline moves + win-rate stats | `src/db.lume` |
| REST API | Route sugar `get`/`post`, error codes + JSON envelopes, flock-serialized concurrent writes | `crm.lume` |
| LLM Agent | `tool` registration (10 typed tools) / SSE chat at `/react/api/chat`, zero-value fallbacks for missing keys | `src/db.lume` + `crm.lume` |
| Frontend SPA | `server { spa = true }` history-routing fallback + single-bundle React shell | `crm.lume` + `src/crm/` |
| Strong typing | Full `.lume` `--check`, fail-fast on the first error; duplicate names / missing keys / type errors caught at build time | repo-wide |

> In one sentence: **business logic is only `.lume` + frontend — no other language runtime involved.**

## Live read-only demo

<https://lume-crm.erishen.cn> runs with `LUME_CRM_READONLY=1`: every write API returns
403, the agent only registers the two query tools (`crm_search_customers` /
`crm_get_customer`), and the UI only exposes query entries (write-type quick prompts
and examples appear only when developing on localhost). The chat page ships
quick-prompt chips for the `crm_*` tools (click to send) and renders markdown tables.
It also includes the "Build with Lume" teaching page (`/examples`, five
copy-pasteable `.lume` DSL snippets) and a site-wide footer
([repo](https://github.com/erishen/lume) +
[intro article](https://erishen.cn/lume), in Chinese). For a writable local run:
`LUME_CRM_READONLY= docker compose up`.

## How it fits together

All business logic lives in a single `.lume` script (served by the C11 single binary
`lume`). The frontend is a React + TypeScript **SPA with history routing**, bundled by
esbuild into one `app.js` dropped into the docroot. There is no Node service — data is
**Lume's built-in SQLite** (`sql_query` physically read-only / `sql_write` guarded +
flock serialization, `.data/crm.db`); the frontend is driven by the JSON API and the
SSE agent chat.

SPA notes: `server { spa = true }` makes static 404s (GET + `Accept: text/html`) fall
back to the root `index.html`, so **clean URLs** (`/customers/3`) survive a refresh
without 404. In-site navigation uses `pushState` client-side routing (no full-page
reload); API/fetch 404s are unaffected.

## Quick start

```bash
make                 # type-check + build frontend + start server (blocks; Ctrl-C to stop)
# → http://127.0.0.1:8089
```

Other targets: `make check` (DSL type check) · `make ui` (frontend only) ·
`make crm-dev` (frontend hot reload + server) · `make clean` (artifacts + data).
`sh run.sh` is a standalone entry point equivalent to the Makefile.

Pages (SPA history routing, clean URLs): `/` dashboard · `/customers` customers ·
`/customers/N` customer detail · `/chat` agent · `/examples` "Build with Lume"
teaching page. Any route can be opened directly / refreshed (`spa=true` falls back
to the shell).

Dependencies: Lume uses **release binaries** (no dependency on a source tree
`../lume`). Install:
`curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh | sh`
(lands in `~/.local/bin/lume`; the DSL features used here need `lume >= v0.5.1` —
pin with `LUME_VERSION=v0.5.1 sh install.sh`). For esbuild, the build prefers
`./node_modules/.bin/esbuild` after a local `npm install`, then `PATH`, then
`../lume/frontend/node_modules` as a transitional fallback. React resolves from
node_modules the same way.

## Docker

The image is based on `alpine:3.20`: since lume **v0.5.1** official `*-static`
prebuilt binaries exist (fetch with `LUME_STATIC=1` via `install.sh`); that binary
bakes libsqlite3 and all of libc into itself — **zero runtime dependencies** — so the
image needs no `libsqlite3-0` and no specific glibc; the base can be alpine and the
image shrank from ~120MB to ~10MB. The frontend `www/` is a pure static bundle
produced by host-side `make ui`, simply COPYed in.

> DNS/egress notes (verified): lume's LLM calls fork + execlp the system `curl`
> (`agent-httpd/src/agent/agent.c`); DNS resolution is handled by alpine's musl curl
> (via Docker's embedded DNS), so hostnames like `host.docker.internal` work — the
> same deployment pattern as lume-invest (container calling a gateway at
> `host.docker.internal:<port>`) is proven in practice. `curl` is a hard dependency
> for real LLM calls (not in base alpine; explicitly installed in the image). lume
> itself never resolves domains; the CRM core (SQLite + SPA + REST API) is fully
> local, so offline demos are unaffected.

```bash
make ui                   # build the frontend first (produces www/app.js)
docker build -t lume-crm:latest .
docker run -d -p 8089:8089 -e LUME_BIND=0.0.0.0 lume-crm:latest
# → http://localhost:8089
```

- `crm.lume`'s `bind` defaults to `127.0.0.1`; inside a container `LUME_BIND=0.0.0.0`
  is required for `-p` port mapping to reach it (local dev keeps the safe loopback
  bind — see `server{}`).
- **Real LLM in the container (wired up)**: compose injects `LLM_API_URL` (your own
  LLM gateway, e.g. `host.docker.internal:<port>/v1/chat/completions`) and
  `LLM_MODEL=auto` from `.env`; neither URL nor key has a hardcoded default — put
  them in a sibling `.env` (gitignored), compose injects via `${VAR}` substitution.
  If either is missing, chat falls back to the offline demo engine.
- **SSR customer share page**: `GET /share/customer?id=<n>` is server-rendered
  (el/html components, zero JavaScript, self-contained CSS) — a link you can send
  around that shows one customer's full profile (deals / activities). All customer
  fields go through `html()` scalar slots — auto-escaped, stored XSS is not
  feasible (verified by test).
  > **C SSR vs React SSR**: lume also supports React SSR — `server{ react_socket }`
  > relays `/react/*` over FastCGI to a resident node process (react-dom/server +
  > StaticRouter + hydration), see `examples/react-ssr.lume`. This CRM **deliberately
  > does not use it**: a resident node process would break the core selling point of
  > "a 14.3MB single binary, no Node runtime"; the framework's built-in C SSR
  > (zero JS, zero deps) covers the business pages. React SSR suits content-heavy /
  > interaction-heavy pages (marketing sites, docs).
- **Discovery page**: `GET /discovery` returns the framework's self-introspection
  directory (readonly flag + tools/skills/mcps). In read-only mode the tool list is
  exactly 4 (2 query DSL tools + calc + get_time) — the security story proves itself
  on the page; the container entrypoint also trims `HARNESS_TOOLS_ALLOW` in readonly
  mode, removing native tools like read_file/fetch_url so the chat agent has no
  file-read or outbound channels.
- **Read-only demo mode (recommended for public, compose default)**: with
  `LUME_CRM_READONLY=1` every write API uniformly 403s and the agent **only registers
  query tools** (the 8 write tools never enter the registry) — no matter how nasty
  the prompt injection, there is no destructive surface to call, so it is **safe to
  demo on the public internet without auth**: visitors can see all data and chat
  with a real model, but cannot break anything. Verified A/B: writable + injection
  of "delete the customer" → really deletes; read-only + same injection → agent has
  no delete tool to call, data intact. Local development without the variable =
  fully writable. See `SECURITY-ASSESSMENT.md` for the full assessment.
- **Public auth (clarified by testing)**: lume's Basic Auth gate is **global** —
  custom `/api/*` routes and built-in routes share the same front gate
  (`http.c`/`event.c` validate before route dispatch); missing/wrong credentials are
  always 401 (fail-closed). Set `LUME_AUTH_USER` + `LUME_AUTH_PASSWORD` on the
  container; the entrypoint generates a `$6$` htpasswd on the fly and **exports
  `HTPASSWD_FILE`** (`crm.lume`'s `env("HTPASSWD_FILE")` depends on it — the earlier
  conclusion that "/api/* wasn't protected" was a misdiagnosis; the real cause was
  the entrypoint forgetting to export, silently disabling auth entirely). A reverse
  proxy is still recommended: TLS is a must; Basic Auth works as defense in depth
  (`deploy/nginx-lume-crm.conf` template kept).
- **Hash format platform differences (read before debugging locally)**: `$5$/$6$` go
  through system libcrypt — fine in Linux containers (glibc); **macOS libcrypt only
  ships DES**, so `$6$` entries are always rejected on macOS (lume logs a warning at
  startup). For local testing on macOS use bcrypt: `htpasswd -bnB user pass` (lume
  ships a portable bcrypt verifier, consistent across platforms).
- **`.env` mechanism (pitfalls, spelled out)**: the image **does not contain** `.env`
  (`.dockerignore` excludes it; the Dockerfile only `COPY`s `.env.example`), so
  lume's `fopen(".env")` inside the container finds nothing and returns — local
  gateway keys never leak into the image. But the lume framework has a **built-in
  `.env` auto-loader** (`agent-httpd/src/agent/llm.c:287`): at startup it
  `fopen(".env")` in the CWD (container CWD=`/app`), injecting `KEY=VALUE` pairs via
  `setenv(s,val,0)` — **override=0, i.e. it never overrides existing process env**.
  Container configuration precedence:

  | Method | Effective | Priority |
  |---|---|---|
  | `docker run -e LLM_API_URL=... -e LLM_API_KEY=...` | ✅ straight into process env | **Highest** (`.env` won't override) |
  | compose `environment:` | ✅ | Highest |
  | Mounted file `-v ./prod.env:/app/.env` (or compose `volumes:`) | ✅ lume auto-loads it | Below `-e` |
  | Nothing | ❌ framework defaults | chat = offline demo |

  - `.env.example` is **inert**: lume only opens the literal `".env"`, not
    `.env.example`, so it is harmless inside the image.
  - `LUME_BIND` / `LUME_AUTH_PASSWORD` go through `-e` or a mounted `/app/.env` too.
  - To get real-LLM chat in the container, either works: `docker run -e LLM_API_URL=...`
    (higher priority) or mount a production `.env` at `/app/.env` (lume loads it itself).

## Layout

```
crm.lume          entry: server{} + HTTP routes + body-parsing sugar + imports the domain library
src/db.lume       domain layer: SQLite data layer (schema/seed + read-write helpers + crm_* tools)
src/api.ts        shared frontend API layer (types + fetch wrapper)
src/crm/app.tsx   SPA shell: history routing (pushState) + unified Nav + mounts four views
src/crm/*.tsx     view components (dashboard/customers/chat/examples, all exported, never self-mounting)
www/app.css       handwritten shared styles (static source, not built)
www/index.html    SPA shell (spa=true fallback target, loads /app.js)
www/app.js + www/chunk-*.js   esbuild output (tracked; after touching src/crm, rebuild with make ui and commit together)
.data/crm.db      SQLite data (auto schema + seed on first run; seed rows are fictional demo data)
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/stats` | dashboard: customer count / deal count / open pipeline / win rate (won/lost/won_amount/win_rate) / per-stage totals / full customer table |
| `GET /api/customers[?q=]` | customer list (`q` fuzzy-matches name/company/email with parameterized `LIKE`; `?sort=pipeline` sorts by pipeline amount desc) |
| `GET /api/customer?id=N` | customer profile (basics + deals [with updated_fmt] + activities newest-first [incl. system audit entries]) |
| `GET /api/meta` | business dictionary: stage whitelist / terminal stages / default stage / activity-kind suggestions (single source of truth for frontend options) |
| `POST /api/customers` | create customer `{name, company?, email?, phone?}` |
| `POST /api/deals` | attach deal `{customer_id, title, stage?, amount?}` (a non-empty stage must hit the whitelist, else 400; amount cannot be negative) |
| `POST /api/deals/update` | move pipeline `{deal_id, stage?, amount?, title?}` (empty/zero fields = no change; moving to a terminal stage auto-records a system activity) |
| `POST /api/activities` | log activity `{customer_id, kind?, note}` |
| `POST /api/customers/update` | update customer profile `{customer_id, name?, company?, email?, phone?}` (empty strings = no change) |
| `POST /api/customers/delete` | delete customer + cascade its deals/activities `{customer_id}` (three-step validated cascade, irreversible) |
| `POST /api/deals/delete` | delete one deal `{deal_id}` (cleanup for misattachments/duplicates) |
| `POST /api/activities/delete` | delete one activity `{activity_id}` (system audit entries should not be deleted, but the server doesn't forbid it) |
| `POST /react/api/chat` | agent SSE (framework-native, `crm_*` tools registered) |

## Agent tools (chat page)

`crm_search_customers` / `crm_get_customer` / `crm_add_customer` /
`crm_update_customer` / `crm_delete_customer` (cascading) /
`crm_add_deal` / `crm_update_deal` (pipeline moves) / `crm_add_activity` /
`crm_delete_deal` / `crm_delete_activity` — 10 typed schemas generated
automatically, with zero-value fallbacks for missing keys (empty string / zero
fields = leave that field unchanged).
`crm_delete_customer` cascades away all of the customer's deals/activities — use
with care in chat.
An empty `LLM_API_KEY` in `.env` = offline demo engine; set it to use a real model.

## Security boundaries (discipline inherited from lume-invest)

- the server only binds `127.0.0.1`; all write paths hold the flock (the SQLite C
  side sets no busy_timeout, so concurrent worker writes are serialized at the app
  layer); `sql_write` is guarded (single statement, DROP/ALTER/PRAGMA forbidden)
- no auth on the server; data sits in `.data/crm.db` — do not expose the port to
  untrusted networks
- values are always bound via `?` placeholders (parameters never enter SQL text,
  eliminating injection); search uses parameterized `LIKE`

## Data-layer design (why it is built this way)

- **lock-free reads**: `sql_query` is physically read-only (`SQLITE_OPEN_READONLY`),
  the GET path never touches the flock
- **new ids use `MAX(id)+1`**: `last_insert_rowid()` is unreliable across connections
  (every exec opens a new one); `MAX` is safe while holding the lock; inserts carry
  an explicit id with AUTOINCREMENT as a backstop
- **first-run schema**: `sql_write` opens without the `CREATE` flag, so a missing db
  file fails to open → when truly missing, `write_file(db, "")` creates a 0-byte
  empty db first (only when actually missing — atomic writes would clobber), then
  `CREATE TABLE IF NOT EXISTS`
- **catchable write failures**: `sql_write` failure sets a sticky VM error and
  returns null → write paths wrap it with `try(() => sql_write(...))`, normalizing
  to an `{ok,err}` shape
- **aggregation pushed into SQL**: the customer table / pipeline stats come out of a
  single `SELECT` + subqueries + `GROUP BY`; no loop aggregation in app code
- **local timezone**: SQL-side `strftime` is UTC; local timestamps are patched on
  the DSL side with Lume's builtin `strftime` (localtime), backward compatible with
  old data
- **single source of truth for the business dictionary**: `deal_stages` (whitelist) /
  `closed_stages` (terminal) / `default_stage` are the only source of stage
  semantics: server-side `stage_valid` validation, `update_deal` audit trail,
  `stats_payload` open-pipeline stats and the `/api/meta` options sent to the
  frontend are all generated from the same constants — adding/changing a stage means
  touching exactly one place, never hardcoding stage names around the codebase
- **audit trail**: moving to a terminal stage with a stage change → a
  `kind=system` activity is auto-recorded under the same lock (rendered as a
  non-deletable "system" tag in the frontend; the server doesn't forbid manual
  deletion, keeping it generic); cascading deletes (deals/activities/customers)
  validate step by step, any failure is a 500 — errors are never silently swallowed
- **display data completed server-side**: customer-profile deals carry `updated_fmt`,
  activities are ordered `at DESC` (newest first) — the frontend does no re-sorting
  or timezone math, removing one copy of that logic
