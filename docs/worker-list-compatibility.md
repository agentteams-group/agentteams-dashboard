# Worker list projections and conditional reads

This Dashboard supports the optional Worker projections from
[AgentTeams #1477](https://github.com/agentscope-ai/AgentTeams/pull/1477) and
the stable-response validators from
[AgentTeams #1480](https://github.com/agentscope-ai/AgentTeams/pull/1480).
It does not require those PRs to be installed first.

| Controller behavior | Dashboard behavior |
| --- | --- |
| Supports projections and ETag | Poll `fields=spec` and `fields=status` in parallel. Revalidate cached spec bytes with `If-None-Match`; always read status afresh. |
| Supports projections without ETag | Use the same projections with ordinary 200 responses. |
| Ignores `fields` | Accept the existing full response, including the older array-shaped collection. |
| Rejects `fields` with 400 | Retry the unprojected full collection. Authentication, permission and infrastructure failures remain errors. |
| Old Dashboard with a newer Controller | The Controller's default/all response is unchanged. |

Rows are joined by their stable `name`, not list position. Status determines
membership, so deleted Workers disappear. If a newly observed name is missing
from the spec snapshot, reload spec once; if the snapshots still disagree,
read the combined `spec,status` collection. None of these paths fetch details
once per row. Concurrent changes and old-Controller fallback can add a bounded
collection request; ordinary polling uses two collection requests.

Opening details, editing or assigning skills first reads `GET /workers/{name}`.
Until that succeeds, the Dashboard does not expose the edit controls. A failed
read leaves them unavailable; cancellation or a later selection prevents an
older response from opening the wrong Worker. Existing skills, agent prompts,
MCP configuration and editable environment variables come from that full read.
Export also uses the full collection rather than the polling snapshot.

Stable version, skill and MCP reads through the common API client can also
reuse validators when the backend supplies them. Cached response bodies stay
in browser-process memory, are bounded to 64 entries, and are never persisted.
Every reuse requires a fresh upstream 304: this is not an offline/stale-data
cache. Common API writes invalidate the cache before and after the request.
Backends without validators continue returning ordinary responses.

The proxy scopes opaque validators to the actual target, server-selected
credential and server-resolved identity/level. A validator from another
account, privilege level or Controller is not forwarded. Browser identity,
credential and connection changes also invalidate local entries; a response
that completes after an observed account/connection switch is rejected.
HTTP responses retain `no-store`, preventing shared/browser HTTP caches from
retaining configuration data independently of this private cache.

ETag reduces repeated transfer. The Controller still executes
the handler to validate the response; it does not eliminate backend queries.
Status/default/all Worker views are never conditionally cached.

Validation uses `npm run lint`, `npm run typecheck`, `npm run test`, and
`npm run build`. Focused coverage includes old-Controller fallback, reordering,
add/delete races, bodyless 304, permission changes, credential/target isolation,
failed detail reads and preservation of existing configuration during edits.
