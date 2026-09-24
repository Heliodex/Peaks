# Security and correctness audit

Last updated: 2026-09-23.

The original review has now been remediated across all nine highest-priority areas. Findings 4 and 9 still have explicitly documented follow-up work, so they are marked as partially resolved rather than closed. The remaining sections are open correctness, security, accessibility, deployment, and tooling work.

## Status summary

| # | Area | Status |
| - | - | - |
| 1 | Media proxy SSRF/open-proxy risk | Core issue resolved; operational hardening remains |
| 2 | Session renewal and expiry | Resolved; session hashing remains optional hardening |
| 3 | Error handler could throw | Resolved |
| 4 | Unbounded remote requests and pasted-ID loads | Partially resolved |
| 5 | Async timelapse load could update the wrong project | Resolved |
| 6 | Share decompression, validation, and import collisions | Resolved for the current URL format; versioning remains future work |
| 7 | Frame capture source and media lifecycle races | Resolved |
| 8 | Timeline shortcuts hijacked focused controls | Resolved |
| 9 | OAuth expiry and refresh handling | Partially resolved; at-rest encryption remains |

## Highest-priority findings

### 1. Media proxy SSRF/open-proxy risk

**Status: Core issue resolved; operational hardening remains.**

The proxy no longer accepts arbitrary authenticated URLs. `src/lib/server/lapse-media.ts` now restricts requests to exact HTTPS Lapse media origins and approved media paths. It rejects credentials, non-default ports, fragments, oversized URLs, and unapproved hosts. Redirects are handled manually, limited to three hops, and checked against the same Lapse/R2 allowlist. The response must be a video response before it is forwarded.

The remaining recommendations are operational hardening rather than the original arbitrary-URL vulnerability:

- Add upstream request timeouts.
- Add response-size and request-rate limits.
- Consider DNS-level controls or an opaque timelapse-ID API if the CDN contract changes.

### 2. Session renewal and expiry

**Status: Resolved; session hashing remains optional hardening.**

`getSessionAndUser.surql` now persists renewal with an explicit `UPDATE`, returns no session after an expired record is deleted, and distinguishes renewed sessions from invalid ones. `hooks.server.ts` deletes invalid session cookies immediately, and the cookie lifetime is aligned with the 30-day database policy.

Regression tests cover renewal, expiry, and deletion. Hashing session IDs at rest is still a reasonable future hardening step, but it is no longer part of the session-expiry correctness issue.

### 3. Error handler could itself throw

**Status: Resolved.**

`handleError` delegates to the null-safe `logServerError` helper and no longer accesses `.status` on an unknown error value. Tests cover nullish, primitive, status-bearing, and logging-failure cases.

### 4. Unbounded remote requests and pasted-ID loads

**Status: Partially resolved.**

The remote thumbnail endpoint now uses a runtime-validated maximum batch size of 50, removes duplicate IDs, and limits upstream work to five concurrent requests with `mapWithConcurrency`. The ProjectTimelapses UI also submits bounded batches. Regression tests cover the schema limit, concurrency limit, and result ordering.

The pasted-ID path in `src/routes/(main)/timelapse-loader.svelte.ts:57-85` still uses `Promise.all` for every new ID and has no separate input-size or concurrency limit. The following original recommendations remain open for that path:

- Bound the number of pasted IDs.
- Use bounded concurrency for pasted-ID resolution.
- Add upstream timeouts and retry/backoff for transient failures.
- Disable duplicate submission while a load is in progress.
- Cache metadata and thumbnails where appropriate.

### 5. Async timelapse load could update the wrong project

**Status: Resolved.**

`TimelapseLoader` now records an operation token, project ID, and open timelapse ID before resolving IDs. It verifies that the operation is still current before seeding entries, encoding a share URL, or navigating. Pending work is cancelled when the surrounding review changes projects or closes the timelapse. Regression tests cover project switches, repeated loads, and stale navigation.

An `AbortController` could reduce unnecessary upstream work, but it is not required to prevent the state corruption described by the original finding.

### 6. Share decompression, validation, and import collisions

**Status: Resolved for the current URL format; versioning remains future work.**

`src/lib/share.ts` now enforces:

- A 4,096-character encoded URL limit.
- A 1 MiB streamed decompression limit.
- Limits for project entries, selections, idle ranges, IDs, names, reasons, and durations.
- Runtime validation of the complete decoded payload.
- Ordered, non-negative ranges bounded by duration.
- Duplicate-ID, overlap, and malformed-value rejection.

Decompression is streamed and cancelled when the byte limit is exceeded. Shared-project imports now reuse semantically identical projects and create incremented numeric names instead of silently replacing a local project with the same ID.

The current payload remains a versionless, self-contained URL. A future format version/migration path and server-side share IDs would improve evolution and scalability, but are no longer needed to prevent the original decompression-bomb and malformed-payload cases.

### 7. Frame capture source and media lifecycle races

**Status: Resolved.**

Frame capture jobs now carry both the source URL and a source-generation token. Source changes clear the queue, dispose the capture pool, reject stale work, and revoke stale object URLs. Media loading and seeking are abort-aware, and `TimelinePlayback` clears the previous frame rate before probing a new source.

Regression tests cover source changes, pending capture disposal, cancellation, and frame-rate reset behavior.

### 8. Timeline shortcuts hijacked focused controls

**Status: Resolved.**

`src/lib/dom.ts` now recognizes buttons, links, media controls, summaries, and common interactive ARIA roles through the composed event path. The timeline key handler and the non-search review shortcuts ignore interactive targets and already-prevented events. The intentional global Ctrl/Cmd+K search shortcut remains available while typing.

Regression tests cover typing targets, native controls, composed paths, and the timeline slider exception.

### 9. OAuth expiry and refresh handling

**Status: Partially resolved; at-rest encryption remains.**

OAuth lifecycle handling now includes:

- Runtime validation of token responses.
- Optional `refresh_token` typing matching the Lapse contract.
- Absolute `accessTokenExpiresAt` persistence in the Surreal schema.
- A refresh-safety window before expiry.
- Per-user single-flight refresh attempts.
- Refresh-token rotation persistence.
- One retry after an upstream `401`.
- Credential clearing and forced reauthentication when refresh is unavailable or rejected.
- Removal of the unused, schema-incompatible `lapseDisconnect` endpoint.
- Reapplication of the database init query during Vite HMR so schema changes do not leave a running development database stale.

The Lapse OpenAPI document does not currently document a refresh-token grant. The application attempts refresh only when a refresh token is present and falls back to reauthentication if the provider rejects it. This should be confirmed when Lapse publishes or updates the refresh contract.

The remaining material security follow-up is bearer-token protection at rest. Access and refresh tokens are still stored in the Surreal database without application-level encryption. A dedicated deployment secret and a migration strategy for existing plaintext values are required before adding encryption.

A browser smoke test after the schema change completed OAuth, loaded the profile and thumbnails, loaded a timelapse, rendered the video, and produced no browser console errors.

## Medium-priority findings

### Idle scans are not explicitly cancelled on reset

**Status: Resolved.**

`ReviewIdle.reset()` now advances the scan revision as well as clearing the published state. `IdleAnalysis` watches that revision, cancels any active job before readiness or source checks can return early, invalidates its callback token, and clears partial state. This prevents a scan from the previous review from publishing ranges after a reset.

Regression tests cover both sides of the lifecycle: `ReviewIdle.reset()` advances the invalidation revision, and `IdleAnalysis` cancels an active job when that revision changes.

Relevant files:

- `src/routes/(main)/review-idle.svelte.ts`
- `src/lib/idle-time.svelte.ts`
- `tests/idle-analysis.test.ts`

### History restoration can differ between SSR and CSR

**Status: Resolved.**

`WorkspaceHistory` now defers persisted-history restoration to `onMount`, so the server and initial client render both start with the same empty history state. The client loader validates the complete project, timelapse, annotation, idle-range, and selection snapshot before use. It also enforces the persisted size/node limits, requires exactly one root, checks reciprocal parent/child links, rejects disconnected nodes and cycles, and normalizes an invalid current/sequence marker safely.

Regression tests cover deferred construction-time loading, valid restoration, broken links, cycles, and malformed nested snapshots. The persisted tree remains size-capped.

Relevant files:

- `src/routes/(main)/workspace-history.svelte.ts`
- `tests/workspace-history.test.ts`

### Local persistence happens on hot interaction paths

**Status: Resolved.**

Selection persistence now waits for a short debounce and keeps only the latest pending state. Share encoding is also debounced and serialized through a single drain loop, so rapid timeline/project edits cannot start overlapping compression jobs. Project writes use the same coalescing approach and flush pending state when the component is destroyed or the review closes.

Storage writes now report success/failure. Project and selection failures are tracked independently and surfaced in the project pane through a dedicated `role="alert"` message, while a later successful write clears only its own failure state.

Regression tests cover selection coalescing, serialized share encoding, project-write coalescing, and recovery after a failed project write. Relevant files include `review-session.svelte.ts`, `project-workspace.svelte.ts`, `ProjectPane.svelte`, and `tests/persistence.test.ts`.

### External API validation and timeouts are incomplete

OAuth token responses are now validated, but profile and timelapse responses are still trusted after basic shape checks or casts. Upstream requests still do not consistently have timeouts, and some profile error paths include raw upstream response text.

The existing runtime-schema dependency should be extended to profile, timelapse, URL, and numeric-bound validation, with generic user-facing errors and detailed server-side logging.

### Accessibility review items

The following remain open review items:

- `TimelineNavigator.svelte` remains pointer-oriented without a complete keyboard equivalent for zooming and panning.
- Project and timelapse context-menu actions should have keyboard-accessible alternatives to right-click-only operation.
- Hidden timeline delete buttons should be removed from the tab order when visually hidden.
- The custom search dialog needs complete focus trapping, inert background handling, and focus restoration.
- The idle sensitivity slider should expose a useful `aria-valuetext`.

## Open security and deployment follow-ups

- Encrypt Lapse access and refresh tokens at rest with a dedicated key and migrate existing plaintext values.
- Add request timeouts, response-size limits, and rate limits to the media proxy and other upstream API calls.
- Add timeouts and bounded retry/backoff to remote timelapse/profile requests.
- Consider hashing session identifiers at rest.
- Pin tested SvelteKit and adapter versions, and document the use of experimental remote functions, async Svelte, and `forkPreloads`.
- Keep deployment configuration to one SurrealDB process/instance, use a stable working directory, and close the database gracefully during shutdown.
- Replace the startup `OVERWRITE` schema strategy with versioned migrations for production. HMR now intentionally reapplies the idempotent init query so local schema edits are visible immediately.

## Tooling and maintenance improvements

- `hooks.server.ts` imports `picocolors`, but it is not a direct dependency in `package.json`; add it explicitly or remove the import.
- Build-time packages such as SvelteKit, Vite, Tailwind, and the adapter are in `dependencies` rather than `devDependencies`.
- `sharp` has no source import and `@typescript/native` is not used by a project script; verify whether both can be removed.
- `prepare` uses `svelte-kit sync || echo ''`, which hides synchronization failures.
- There are no `lint`, `format:check`, or `test` scripts and no visible CI configuration.
- `ecosystem.config.js:8` contains `intperpreter`; the PM2 option is `interpreter`.

## Refactoring opportunities

The main composition roots remain large:

- `TimelapseReview.svelte` coordinates workspace, session, idle analysis, history, layout, shortcuts, and rendering.
- `Timeline.svelte` combines playback, viewport, selection editing, idle scanning, thumbnails, gestures, and rendering.
- `workspace-history.svelte.ts` combines tree algorithms, diffing, graph layout, persistence, and Svelte state.
- `share.ts` combines compression, parsing, validation, domain recomputation, and local-storage side effects.
- `api.remote.ts` mixes transport definitions, authorization, database access, Lapse API calls, and batching.

A future refactor could separate pure domain/schema modules, the Lapse API client, session/auth persistence, share codecs, workspace controllers, and presentation components.

## Verification

Latest verification for the current tree:

- `bun test`: 131 tests passed.
- `bun run check`: passed with 0 errors and 0 warnings.
- `bun run build`: passed.
- `bun audit`: no known vulnerabilities in 175 checked packages.
- `git diff --check`: passed.
- `bunx biome check src tests`: currently reports three formatting issues in `src/lib/assets/favicon.svg`, `src/routes/(main)/ProjectSearch.svelte`, and `src/routes/layout.css`; the files touched by the high-priority fixes pass targeted Biome checks.

Relevant documentation consulted includes [SvelteKit remote functions](https://next.svelte.dev/docs/kit/remote-functions), [Svelte effects and teardown](https://next.svelte.dev/docs/svelte/$effect), [SvelteKit server-only modules](https://next.svelte.dev/docs/kit/server-only-modules), [SurrealDB security guidance](https://surrealdb.com/docs/learn/security/best-practices/security-best-practices), and the [Lapse OpenAPI specification](https://api.lapse.hackclub.com/openapi.json).
