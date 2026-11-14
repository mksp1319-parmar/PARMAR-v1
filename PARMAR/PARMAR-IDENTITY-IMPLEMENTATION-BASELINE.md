# PARMAR Identity Implementation Baseline

| Field | Value |
|---|---|
| Status | Architecture baseline for implementation planning; not an implementation, provider selection, production-auth approval, migration authorization, or release approval |
| Authority | Approved requirements IT-01–IT-15 in [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md); approved product directions D-01–D-13 in [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md) |
| Evidence cutoff | Current repository working tree inspected for Task 35; source/document presence is not runtime or security acceptance |
| Scope | PARMAR-wide identity boundary, VOKKI authorization perimeter, AETHER Desktop credential isolation, AETHER Android offline boundary, migration and approval gates |
| Decision boundary | No provider, protocol, production topology, schema, credentials, or implementation is selected or authorized here |

## 1. Verdict and non-negotiable safe states

**Architecture baseline: ready for gated contract and test planning. Production authentication, SSO integration, cross-user sharing, production data migration, external AI egress, and release remain BLOCKED** pending the approvals and evidence in this document. The baseline resolves the review findings at the architecture/acceptance level; it does not claim that controls have been implemented or verified at runtime.

Maintain all of the following:

1. One immutable PARMAR account identity across VOKKI, AETHER authenticated surfaces, and future PARMAR products. No separate VOKKI or AETHER account, login, credential set, or identity namespace.
2. Provider and protocol selection remain deferred until a documented candidate comparison and explicit security approval. No provider, protocol, SSO handoff, shared-cookie, or token topology is implied.
3. No automatic account linking or merging, including on matching email, phone, name, or other attributes. Optional method linking requires fresh proof and explicit user action.
4. Authentication establishes identity only. Product/resource authorization, consent, approval, execution, verification, and browsing authority remain separate.
5. `REMOTE_BROWSING_ENABLED=false` remains unchanged. Desktop remote browsing stays NO-GO until the isolation gates below pass independently.
6. AETHER Android remains offline-only: no `INTERNET` permission, WebView/browser engine, network client/request, remote authentication, online SSO, or PARMAR/VOKKI service call.
7. VOKKI memory remains user/account-scoped by default; no automatic profile/workspace migration or sharing. Legacy unprofiled conversations remain unassigned.
8. No production authentication, provider integration, migration, external egress, or source-code change is authorized by this document.
9. VOKKI and AETHER remain independent products under PARMAR Core governance and continue as parallel workstreams. Neither product depends on the other's UI, local data, or permissions.

## 2. Finding-by-finding resolution matrix

“Resolved” below means that the architecture contract and acceptance requirement are now explicit. It does not mean code or runtime acceptance exists.

| Finding | Disposition and concrete correction | Measurable acceptance / evidence | Dependency or remaining gate |
|---|---|---|---|
| **H-01 — Desktop authenticated-control credential isolation** | **Resolved in baseline; implementation blocked.** A PARMAR-authenticated control surface, if separately approved, MUST run in a dedicated trusted control-plane process/surface and origin, with a credential store and Electron session/cookie partition that are distinct from every AETHER browser profile. It MUST NOT reuse `profilePartition(...)`, browser profile `userData`, browser cookies, renderer storage, browser preload, or browser request headers. Remote page content receives no PARMAR credential, session token, authentication proof, identity API, generic credential IPC, or privileged identity capability. Control IPC is explicit, sender/origin-validated, least-privilege, and carries no reusable credential. Authentication never enables browsing. | On each supported OS and exact release build: independently inspect process/origin and storage/session separation; enumerate all browser IPC capabilities; observe browser network requests; verify **zero** PARMAR credential/token/proof values, auth cookies/headers, or identity-capability responses reach browser content or browser-origin requests. Repeat with hostile navigation, redirects, renderer restart, profile switch, and control logout. Any failure or untested supported OS is NO-GO; `REMOTE_BROWSING_ENABLED=false` remains in force. | Separate control-plane topology and secure-store design require product/security/platform approval. Current evidence reports Linux-only child isolation, non-Linux in-process browser behavior, and incomplete runtime acceptance; the current implementation is not independent proof. AETHER Gate D/platform review is required before any browsing decision, separately from identity approval. |
| **H-02 — Complete VOKKI route/data authorization inventory** | **Resolved in baseline; enforcement blocked.** Section 5 inventories every explicit GET/POST application route found in `PARMARRequestHandler`, classifies public/demo behavior, identifies principal/owner/profile/workspace/grant checks, and records denial/testing obligations. Unlisted routes and methods deny by default. Section 6 covers sensitive resource classes without current routes. | Before any production exposure, produce an automated route census and reconcile it to Section 5: **100%** of registered path/method pairs and sensitive data operations have an owner, principal, authorization predicate, denial behavior, and tests. With two synthetic accounts, at least two profiles per account, and two workspaces, **zero** cross-account/profile reads or writes succeed absent an owner match or an explicit, current, resource-scoped grant. Membership-only and revoked-grant cases deny on the next authorization decision; unknown routes/methods deny. | Requires owner assignment, route-level authorization implementation, and independent review. Until complete, production exposure and all cross-user sharing are blocked; owner-only synthetic contract work may proceed with deny-by-default behavior. |
| **H-03 — Production authentication and SSO topology approval** | **Resolved as an explicit approval gate; production authentication remains BLOCKED.** The contract is provider-neutral and defines the required outcome: one PARMAR account across protected products, distinct product audiences and authorization, no separate product accounts, no shared broad browser authority, and explicit account/session lifecycle semantics. It deliberately does not choose how sessions are established or propagated. | Before provider selection or integration: retain a requirements-based candidate comparison, explicit security approval, and an approved SSO contract covering account resolution, product audiences, handoff/assertion expiry and replay, session issuance/storage, logout and revocation propagation, recovery, failure behavior, and the absence of separate product credentials. After that gate, synthetic end-to-end tests prove the same PARMAR account resolves across VOKKI and any approved authenticated AETHER surface while product permissions remain independent. | Product, security, privacy/legal, and operations approval is required. Until then: no provider/protocol selection, production sign-in, SSO session issuance, or authenticated cross-product integration. |
| **M-01 — Legacy user-owner to PARMAR-account mapping** | **Resolved as a migration prerequisite; migration blocked.** Treat each legacy VOKKI `user_id`/`owner_user_id`, PARMAR `account_id`, AETHER local profile ID, Desktop partition, and Android local state as distinct namespaces. Mapping requires an approved mapping record with source namespace/ID, target immutable account ID, proof/provenance, actor, time, and review status. Ambiguous, duplicate, orphaned, or unverified records are quarantined and remain inaccessible/unassigned; never infer identity from UUID equality or matching attributes. | Dry-run against a preserved snapshot: exact per-data-class and per-owner before/after counts reconcile; every migrated owner has explicit verification evidence; **zero** ambiguous/orphan records are assigned; **zero** `profile_id = NULL` conversations are auto-assigned; memory and consent scope is unchanged; two-account isolation tests pass. A rollback exercise restores the pre-cutover mapping/access state without overwriting source records or broadening visibility. | Requires an approved account lifecycle/mapping policy, owner-verification process, privacy/security/data-owner approval, tested backup/restore, and separately authorized migration. No migration or session upgrade is authorized now. |
| **M-02 — Consent-revocation race at external transfer** | **Resolved as a transfer-boundary rule; external egress blocked.** Consent authorization is versioned and serialized with each transfer. The linearization point is immediately before the first byte leaves the trusted egress boundary. Revocation commits a newer version and cancels queued work. If revocation commits first, the request sends **zero bytes**. If the transfer wins the boundary first, the record must show that it was already authorized/in flight; revocation blocks every later transfer and must not imply recall of data already sent. No silent provider fallback. | Deterministic barrier-controlled race tests cover both orderings. Revocation-first produces exactly **0** outbound requests/bytes; transfer-first has one auditable in-flight/accepted transfer and **0** subsequent transfer attempts after revocation. Test queued, retry, provider-unavailable, cancellation, and partial-send outcomes; user-visible status distinguishes not sent, in flight, sent, and not recallable. | Requires a separately approved consent/data-category policy, provider/endpoint and terms review, transport instrumentation, and privacy/security acceptance. This contract does not select a provider or authorize egress. |
| **M-03 — Profile grant semantics not implementation-ready** | **Resolved as a deny-first grant contract; sharing remains disabled pending approval.** All grants are explicit, owner-issued, revocable, resource-specific, grantee-specific, and operation-mapped; they never derive from workspace membership, role, or administrator status. Safe proposed mapping: **View** = read/list/search; **Edit** = View plus create/update; **Manage** = View/Edit plus resource-scoped delete/archive/settings. None of these grants transfers ownership, changes account/security settings, creates workspace membership, authorizes export, approves/executes actions, or delegates grants. Export and grant administration remain owner-only unless separately approved. Unknown operations deny. | After product/security approval of the mapping, test owner, explicit View/Edit/Manage grantee, membership-only user including workspace ADMIN, unrelated account, expired grant, revoked grant, stale context, and attempts to escalate/delegate. Every route/action has an explicit mapping; ungranted operation denies. Revocation is rechecked on the next request, with no stale grant cache permitting access. | The permission map is a baseline proposal, not a conversion of deferred IT-08 policy into approval. Product/security/privacy owners must approve exact operation semantics, workspace/member lifecycle, revocation behavior, and whether any future delegation exists. Until then all cross-user profile/resource access is denied and sharing endpoints are disabled. |
| **L-01 — Parallel-plan account-independence wording** | **Clarified for this baseline.** “AETHER independence” means AETHER local/offline product work and its unauthenticated local shell can proceed without a PARMAR account/provider. It does **not** mean an authenticated PARMAR surface may create an AETHER account or login. Any separately approved authenticated AETHER surface uses the shared PARMAR identity contract and has no browsing authority by default. | Workstream and integration designs consistently show (a) local/offline AETHER remains usable without account/network and (b) every authenticated PARMAR surface uses the one PARMAR identity contract. Review the plan wording against this interpretation before cross-product integration. | The existing parallel-plan file is intentionally unchanged under the one-new-file constraint. Its wording may be clarified in a separately authorized documentation task; this baseline does not change D-02 or authorize integration. |

## 3. Corrected identity and cross-product architecture

### 3.1 PARMAR-wide SSO and account contract

- PARMAR Core is the sole authority for the immutable PARMAR account ID, verified authentication-method mapping, account lifecycle, and shared identity/session contract.
- VOKKI, AETHER authenticated surfaces, and future PARMAR products resolve to that one account identity. They MUST NOT create product-local account IDs, password stores, login methods, or credentials as alternate identities.
- Local-only functionality, including AETHER local profiles, is usable without sign-in where its product contract permits and does not create another PARMAR account.
- Provider and protocol remain unselected. A shared account requirement is not approval for shared cookies, a common browser session, a token format, or a particular handoff.
- A verified principal is server-derived and audience/context-bound. Product services independently authorize each resource and action. Shared identity does not grant profile/workspace access, approval, execution, AI egress, or browsing authority.
- Automatic account linking or merging is prohibited. Any optional future login-method linking requires explicit user action, fresh proof of control of the new method, conflict checks, notification/audit, and a separately approved recovery path.
- Local Demo/development identity is not a PARMAR account and must never be silently upgraded or mapped to one.

### 3.2 Components and trust boundaries

```text
                         PARMAR Core trust domain
  Account / method mapping (provider TBD; no account inference)
       |       Session, device, recovery and revocation contracts
       |       Product-audience identity assertion / handoff (TBD)
       |       Policy, consent, approval and audit authorities
       |
       +-------------------------+---------------------------+
                                 |                           |
                           VOKKI API                 AETHER control plane
                    server-derived principal        trusted, dedicated
                    owner/grant checks per route    process/origin/store
                    no client authority             no browser credentials
                                 |                           |
                    VOKKI-owned data/actions         narrow non-identity IPC
                                                             |
                                                   AETHER browser content
                                                   no PARMAR identity authority
                                                   remote browsing remains OFF

  AETHER Android: local-only shell/data; no network or remote-auth path.
  Future products: same PARMAR identity contract; independent resource policy.
```

| Component/boundary | May receive | Must never receive or imply | Required behavior |
|---|---|---|---|
| PARMAR identity authority | Approved authentication proof, verified method mapping, server account state | Client-selected account IDs or attribute-based account equivalence | Issue stable account identity only after approved verification; fail closed on ambiguity |
| Product API edge | Server-resolved, audience-valid principal/session | Client-supplied identity, owner, role, grant, membership, or consent as authority | Resolve server-side; reject identity injection; default deny unknown route/policy |
| VOKKI resource service | Principal, action, resource and authoritative ownership/scope metadata | UI-selected profile/workspace as permission; membership as personal-content grant | Enforce Section 5 matrix at every read/write/export/action and revalidate at commit |
| PARMAR control plane on Desktop, if approved | Its own dedicated control-session credential in approved secure storage | Browser profile/session state; credentials in renderer globals, preload, URL, logs, or browser IPC | Separate process, origin, storage, and session; narrowly scoped authenticated calls |
| AETHER browser content | Only non-identity browser-control operations explicitly approved for that surface | PARMAR credential, session token, auth cookie/header, passkey proof, identity API, or privileged identity capability | No identity-bearing network requests or reusable credential IPC. No remote browsing until independently verified |
| AETHER Android | Local app state under the offline contract | PARMAR account credentials, network/SSO service, WebView/browser engine, external request | Remain functional offline without account; no networking or online identity |
| External AI/data recipient | Only minimum data after purpose/scope consent and a separately approved egress path | Credentials, unrelated profiles, unapproved history, data after revocation boundary | Deny on missing/ambiguous/unavailable consent or provider; no fallback |
| Support/operator | Operational metadata authorized for the support duty | Standing access to private content or implicit owner authority | No standing private-content access; exceptions require separate time-bounded, purpose-bound, audited approval |

### 3.3 Session and authorization separation

Session resolution establishes a principal and assurance context; it does not decide resource access. Every protected operation supplies a server-built tuple: account, product/audience, action, resource type/ID, owner, active profile/workspace where relevant, applicable explicit grant, purpose/consent where relevant, and current policy version. Missing policy, stale scope, unavailable identity/authorization/consent, or failed revalidation denies the operation. Step-up is an additional condition, never a substitute for authorization.

No product or browser renderer may reuse credentials across audiences. Session lifetimes, handoff protocol, token shape, recovery factors, step-up thresholds, and revocation latency remain deferred and require approval before implementation.

## 4. Authorization rules and denial contract

1. **Principal:** derive only from an active server-validated credential for the intended product audience. Reject client-supplied account/user/owner/role/grant/workspace/consent fields. Do not downgrade a failed authenticated request to another user or demo account.
2. **Owner:** compare the authenticated account to the resource's authoritative owner on every operation. Use resource-scoped lookup predicates; never fetch by resource ID and authorize later only in the UI.
3. **Profile:** an active profile is context, not authority. Require owner match or an explicit current grant for that exact profile/resource and action. Profile switching invalidates prior profile-scoped state and stale responses.
4. **Workspace:** membership may establish access to workspace-scoped records only under an approved workspace policy. It never grants personal profile, conversation, memory, or file access. Workspace `OWNER`, `ADMIN`, or `MEMBER` status does not create or expand a profile grant.
5. **Explicit grants:** require an owner-issued, revocable, exact-resource and exact-grantee grant. Missing, expired, revoked, ambiguous, or operation-mismatched grants deny. No wildcard or inherited grants. The proposed View/Edit/Manage map in M-03 is inactive until its approval gate passes.
6. **Consent:** consent is separate from authentication and authorization. External transfer requires current account-, purpose-, scope-, and data-category consent at the boundary defined in M-02. Local memory consent is not external-provider consent.
7. **Approval/action:** a pending approval is owner-, session-, action-, and relevant profile-bound, expiring, single-use, and revalidated before consumption/execution. Identity or step-up never constitutes approval or execution authority.
8. **Failure behavior:** invalid/missing session -> 401 (or the established non-enumerating unauthenticated response); authenticated but disallowed -> 403; missing or non-owned resource -> 404 where needed to prevent enumeration; invalid profile context -> 409; unavailable security-critical service -> explicit 503/deny. No failure may return success-shaped data or mutate state.
9. **Unknown perimeter:** unlisted paths, methods, resource types, or operations deny (404/405/501 as appropriate). A new route or data class is not releasable until it is in the reviewed matrix with tests.
10. **Unsafe web methods:** require validated origin and CSRF protections for cookie-authenticated requests. GET is read-only and has no side effects.

## 5. VOKKI route authorization matrix

The inventory below is the explicit HTTP surface found in [`interface/futuristic_app.py`](./interface/futuristic_app.py): `do_GET` begins at line 689 and `do_POST` at line 952. This describes the inspected handler surface, not a production route certification. The required column is the target baseline. Existing Local Demo/development behavior remains a separate non-production scope.

| Method and route | Data/operation and required principal | Ownership, workspace, grant, consent checks | Denial and required cross-user/profile test |
|---|---|---|---|
| `GET /` | Public static application shell; no account data | No private data in served asset | Static response only; verify no embedded secrets or private user state |
| `GET /static/{path}` | Public static assets | Canonicalize beneath static root; no private/user files | Invalid/traversal path -> 404; verify containment and no private data |
| `GET /api/session` | Public session-status view of the caller's own browser session; no account lookup | Return no account ID or other user's data; any CSRF/session metadata belongs only to resolved session | Anonymous response exposes only anonymous state; user A's session never reveals B; invalid session never resolves to another principal |
| `GET /api/identity/profiles` | Authenticated account principal | Return only profiles owned by the account; no grantee profiles unless explicit profile grants are approved and applied | No/invalid session -> 401; A cannot list B's profiles; membership alone returns no personal profile |
| `GET /api/identity/workspaces` | Authenticated account principal | Return only owned/member workspaces and only approved workspace metadata; membership does not expose associated personal content | A cannot enumerate unrelated workspace; membership-only user receives no profile/content authority |
| `GET /api/identity/workspaces/{workspace_id}/profiles` | Authenticated principal plus valid workspace context | Require active membership **and** an explicit grant to each returned profile for the operation; membership alone must not reveal profile content. Until grant semantics are approved, expose no shared profiles | Invalid/non-member workspace -> non-enumerating 404/deny; membership-only, unrelated account, or revoked grant sees zero profile records |
| `GET /api/conversations` | Authenticated account and valid active profile | Restrict list to account owner and active profile; no workspace-derived access; legacy null-profile records stay unassigned | No session -> 401; missing profile -> 409; B and wrong-profile IDs never appear; membership-only user sees zero |
| `GET /api/conversations/{conversation_id}` | Authenticated account and valid active profile | Resolve by conversation ID **and** owner account **and** active profile; any future share requires an explicit grant mapped to read | Wrong owner/profile, null/unassigned record, invalid ID -> 404; test guessed IDs across two users/profiles |
| `GET /api/memory` | Authenticated account | Owner-only memory/consent state; memory is account/user-scoped, not profile/workspace-scoped; no grants for another user's memory | No session -> 401; B/profile/workspace context cannot read A's memory; consent revocation blocks retrieval, not by implying deletion |
| `GET /api/providers` | Public only for sanitized readiness metadata; otherwise require authenticated product access | No secret, credential, account, provider-selection authority, or external transfer | Verify response contains no secret/configuration detail and causes zero provider calls |
| `GET /api/scenarios` | Public static/synthetic scenarios only | No user or workspace data and no side effects | Verify scenario content is synthetic and cannot disclose private data |
| `GET /api/phone` | Anonymous Local Demo only; simulated status, not device access | Must not represent real device permission or a PARMAR identity; production build disables demo route unless separately authorized | Authenticated caller -> 403; verify no device API or sensitive data access |
| `POST /api/auth/development` | Explicitly configured development-only flow; never a production authentication method | Must be disabled in production; cannot create or map a PARMAR account; strict same-origin/TLS, empty request contract, and no existing session | Production configuration -> unavailable/404; reject client identity, cross-origin, malformed, or repeated login; no identity upgrade |
| `POST /api/logout` | Authenticated caller's current session; idempotent for anonymous local state | Revoke only the caller's current session; account-wide logout requires a separately approved session/device endpoint and must invalidate pending approvals | CSRF/origin failure or storage outage -> deny and surface; verify A cannot revoke B's session, and successful logout invalidates the old credential |
| `POST /api/session/profile` | Authenticated account/session | Select only a profile owned by caller; no workspace membership or grant may change ownership; clear stale profile state | No session -> 401; invalid/non-owned profile -> 404; A cannot select B's or another profile's ID |
| `POST /api/identity/profiles` | Authenticated account | Create profile with server-assigned owner/account; reject client owner/profile/grant fields | No session -> 401; test injected owner/account IDs and verify only caller owns created profile |
| `POST /api/identity/workspaces` | Authenticated account | Create workspace owned by caller; membership/roles must follow approved workspace policy; until approved, no role may grant personal-content access | No session -> 401; injected owner/role denied; verify unrelated accounts cannot observe private workspace data |
| `POST /api/identity/workspaces/{workspace_id}/profiles/{profile_id}` | Authenticated account; sensitive profile-to-workspace association | Target contract requires profile owner authorization, workspace membership/context, and an explicit resource grant. Workspace OWNER/ADMIN alone is never permission to expose another account's profile. Existing association primitive is not a grant. Keep cross-user exposure disabled until M-03 approval and implementation. | Membership/admin-only, wrong owner, wrong workspace, or revoked grant -> deny/no mutation; test owner, explicit grantee, membership-only ADMIN/MEMBER, unrelated account, and revocation |
| `POST /api/memory` (`consent`, `save`, `update`, `delete`, `clear_all`) | Authenticated account | Consent and records belong to account owner. Save/update require active memory consent; delete/clear remain owner-only. Consent revocation stops future retrieval/consent-dependent processing but does not itself delete records | No session -> 401; wrong-owner IDs -> 404/no mutation; missing/revoked consent -> 403 for save/update; test every action with two accounts and no cross-profile movement |
| `POST /api/analyze` | Public only as stateless, non-persisting, non-egress analysis; authenticated session required before storing a request, creating a pending approval, using private context, or invoking a protected action | Never accept caller-supplied identity or approval authority; any persisted/approval data is owner/session-bound; external transfer follows separate consent gate | Unauthenticated persisted/action path -> 401/403; test that anonymous analysis creates no approval, private record, or external request |
| `POST /api/scenarios/evaluate` | Public synthetic scenario evaluation only | No user data, account authority, approval, or real side effect | Verify all fixtures synthetic; unknown scenario -> 404; outbound calls and persistent writes = 0 |
| `POST /api/approval` | Authenticated account and active server session | Pending approval must match caller, session, exact action/request, expiry, single-use state, and profile context; no workspace grant can substitute | Missing/invalid session -> deny; wrong owner/session/profile, altered request, expired/replayed approval -> deny with no side effect; test two accounts and profile switching |
| `POST /api/chat` | Authenticated account for persisted conversation, memory, approval, or protected product behavior. A narrowly bounded Local Demo may be anonymous only when non-persistent, clearly labeled, and unable to use private data or protected capabilities | Existing conversation ID must match owner and active profile; new conversations bind to server principal/profile; memory retrieval is owner-scoped and consented; external provider requires M-02 consent/egress gate | No valid owner/session for persisted/action path -> deny; guessed conversation IDs and cross-profile requests -> 404/deny; anonymous demo produces no account data, persistence, approval, or external egress |
| `POST /api/phone` | Anonymous Local Demo simulation only; production route disabled absent separate decision | No device API, network access, user account, or real permission is implied | Authenticated caller -> 403; test simulated-only behavior and zero device/network access |

### 5.1 Route coverage and current implementation limits

- The handler implements GET and POST dispatch; other methods have no explicit application route contract and must be rejected, not implicitly authorized. `/api`, unknown `/api/*`, malformed dynamic paths, and future unlisted paths are deny-by-default.
- The route inventory includes public and Local Demo routes so they cannot be confused with protected user-data routes. Public status/scenario/static responses must remain data-minimal and side-effect-free.
- Existing source has a development-only login, server-side session primitives, owner-filtered conversation and memory repositories, and profile/workspace endpoints. Task 37 adds an internal, provider-neutral account-registry foundation; it does not prove production authentication, provider binding, SSO, complete route coverage, or production-ready authorization.
- Existing `workspace_profiles` association and `OWNER`/`ADMIN`/`MEMBER` roles are not the approved explicit View/Edit/Manage grants. The association/write route and workspace-profile listing cannot be treated as permission to expose personal profile data.
- Existing repository methods for conversation delete, memory export/reset, device inventory, account recovery/closure, file/task/audit operations, and grants do not imply that corresponding protected HTTP routes exist or are authorized.

## 6. Sensitive resource inventory beyond current routes

No route for the following resource/operation families was identified in the inspected `do_GET`/`do_POST` handler. They remain **unavailable/deny-by-default** until a concrete route and method is added to the matrix, reviewed, and tested.

| Resource or operation | Required authentication and ownership | Workspace/grant condition | Default denial and test |
|---|---|---|---|
| PARMAR account and authentication methods; enroll/link/recover | Fresh approved authentication proof; account owner only | No workspace role/grant | Unknown/duplicate method, stale proof, conflicting mapping, or unverified owner denies; no auto-link/merge |
| Session/device inventory; individual/all-device logout; step-up | Active account session; caller's own devices/sessions; fresh step-up where approved | No workspace grant | Other account's session/device cannot be listed or revoked; unavailable session authority denies |
| Profile grant create/revoke and invitation/member lifecycle | Profile owner for grants; separately authorized workspace owner for membership actions | Exact resource, grantee, operation and expiry; membership does not imply personal-content access | Missing owner proof, wildcard, privilege expansion, expired/revoked grant, or unauthorized delegation denies |
| Conversation deletion/export/reset and history migration | Authenticated owner; resource owner checked for every record; unassigned legacy records remain unassigned | No workspace grant by default; any share/export needs separately approved operation scope | Wrong-owner record changes = 0; export cannot include another account; migration has owner review and rollback |
| Files, uploads, media, research sources and provider-transmitted copies | Authenticated owner for private data; server-derived owner and purpose | Workspace membership alone denies; explicit resource grant only after approved data-class policy | Wrong owner, unsupported data class, missing consent, retention/backup uncertainty, or unavailable policy denies |
| Tasks, action execution, approvals, and results | Authenticated actor; exact resource/action/approval binding; independent PARMAR policy and executor authority | No profile/workspace grant substitutes for action approval | Missing/expired/replayed approval or unavailable policy denies with no side effect; uncertain execution result is not success |
| Audit records and security events | Authenticated owner access only to permitted self-service records; operator access separately governed | No user/workspace grant to internal audit or another user's event | No standing support access; no secrets in output; unauthorized access denied and audited |
| Account export, reset, deletion, closure and support exception | Authenticated owner, required step-up, and lifecycle service | No workspace/admin authority over another account | Durable truthful job status; partial failure not “complete”; sessions/approvals revoked; no standing support access |
| External AI egress, consent and revocation | Verified account plus purpose/scope/data-category consent at transfer boundary | Product/resource ownership and any grant checked before data selection | Missing, revoked, stale, unavailable, or mismatched consent yields zero egress; no silent fallback |

## 7. Desktop credential-isolation requirements

1. **Separate control plane:** any future authenticated PARMAR UI/session broker is a separately trusted process/surface and origin, not merely a different renderer within the AETHER browser's trust domain. Its process, lifecycle, origin validation, and privilege boundary must be documented per supported OS.
2. **Separate storage and session:** use a dedicated, OS-protected control credential store and a dedicated Electron session/cookie store. It must not be the default session or any `persist:parmar-aether-*` browser profile partition; no cookie jar, local storage, cache, database, or credential file is shared with browser profiles.
3. **No credential path to content:** PARMAR passwords/proofs/tokens/cookies/auth headers and privileged identity operations must never enter browser renderer memory, page globals, preload API, navigation/URL, downloads, browser IPC, browser profile files, logs, telemetry, crash reports, or remote requests.
4. **Narrow control IPC:** validate sender process, origin/frame, message schema, audience and action. Do not expose a generic token getter, arbitrary fetch/header injection, session forwarding, identity query, or credential-bearing response. Browser controls, if separately permitted, are non-identity, bounded capabilities only.
5. **Independent network gate:** no authentication state, identity assertion, or successful control login may enable navigation or weaken request-denial policy. Preserve `REMOTE_BROWSING_ENABLED=false` and all existing AETHER containment/admission NO-GO gates until separately authorized.
6. **Independent verification:** reviewer is independent of implementation and checks every supported OS and packaged build. A Linux-only pass does not establish non-Linux isolation. Record exact artifact/ref, process tree, origin/session-store inventory, IPC surface, captured requests, test results/skips, and residual risks.
7. **Acceptance is binary:** any credential exposure, shared cookie/session/storage, unreviewed IPC capability, untested claimed OS, or unresolved browser process boundary means NO-GO. Do not enable remote browsing as a test shortcut; isolation can be tested while browsing remains disabled.

Current source evidence: [`security.cjs`](./desktop/security.cjs#L5) sets remote browsing false; [`profile-partitions.cjs`](./desktop/profile-partitions.cjs#L8) defines persistent browser partitions; [`main.cjs`](./desktop/main.cjs#L1285) creates profile sessions, while the control and browser windows use different preload configurations at [`main.cjs`](./desktop/main.cjs#L1347) and [`main.cjs`](./desktop/main.cjs#L1480). [`ISOLATION-READINESS.md`](./desktop/ISOLATION-READINESS.md#L1) documents Linux child-process isolation, non-Linux in-process behavior, and remaining acceptance limits. No PARMAR identity integration is evidenced.

## 8. Android offline-only constraints

- The current contract remains local-only and usable without account or network. Do not add Android `INTERNET` permission, `WebView`, browser engine, HTTP/network client, DNS/network requests, remote images/fonts/analytics, PARMAR/VOKKI calls, remote auth, online SSO, background sync, or credential storage.
- Android local profile/data is app-local state, not a PARMAR account or identity session. No credential migration or account linking is implied.
- Any future request for authenticated Android functionality is outside this baseline and requires a distinct explicit product/security decision, a separate product surface and network-boundary design, and revised offline-contract approval. Until that occurs, no Android online identity feature is authorized.
- Acceptance for a separately authorized future Android release must inspect the merged packaged manifest and dependencies and observe device/emulator network behavior across flows; required result is no `INTERNET` permission, WebView/network dependency, remote-auth call, or outbound request. This baseline does not claim those runtime checks were executed.

Evidence: [`AndroidManifest.xml`](./android/app/src/main/AndroidManifest.xml#L1) has no declared permissions in the inspected source and disables backup; [`AETHER-MOBILE-OFFLINE-CONTRACT.md`](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9) prohibits network, WebView, external handoff and PARMAR/VOKKI calls; [`PERSISTENCE-ARCHITECTURE.md`](./android/PERSISTENCE-ARCHITECTURE.md#L1) states SQLite source is not built/device-verified.

## 9. Migration, rollback, and data preservation

### 9.1 Preconditions and mapping

1. No source owner UUID, account ID, provider subject, email, phone, profile ID, browser partition, cookie, or Android local identifier is interchangeable by shape or value.
2. Obtain and preserve a source snapshot and inventory by data class before migration. Keep the original data and ownership fields immutable during the dry run.
3. Create a separately approved mapping ledger that records the exact source namespace/identifier, target immutable PARMAR account ID, owner verification evidence/reference, verifier, timestamp, decision, and mapping version. Do not store unnecessary authentication proof in the ledger.
4. Require the data owner to prove control of the legacy data and the target account under an approved process. Matching attributes, UUID equality, support assertion, or possession of a device alone is insufficient.
5. Quarantine missing, conflicting, duplicate, or ambiguous mappings. Do not expose quarantined data to any account; resolve only through a separately approved owner-verification process.
6. Keep `profile_id = NULL` conversations unassigned. Do not assign by current/last active profile, workspace, family/team membership, or account creation time.
7. Keep memory and consent user/account-scoped. No migration to a profile/workspace and no broadened consent. Do not convert Local Demo or legacy session rows/tokens into production sessions; require new authentication and revoke legacy sessions/approvals under their authority.
8. Do not merge VOKKI records with AETHER local state, browser partitions, cookies, or Android SQLite state. Any future association is a separate, explicit, user-controlled migration.

### 9.2 Dry run, cutover, rollback

- Run a read-only dry run on a protected snapshot with synthetic test identities first. Report exact input/output counts by data class and owner, all mapping provenance, duplicates, orphans, null-profile counts, memory/consent scope, and access-test outcomes.
- Before a production migration, require documented owner consent, privacy/security/data-owner approval, verified backup/restore, an exact migration version/manifest, and a rollback runbook. No destructive re-keying, source deletion, or dual identity write is allowed by this baseline.
- Stage a small explicitly approved cohort. Verify counts, account ownership, profile scope, memory/consent visibility, and two-user isolation before expanding. Stop on any mismatch; do not suppress a failed row into a success total.
- Rollback must restore the prior mapping/access decision and preserve original source records. Revoke any new sessions issued under an invalid mapping, invalidate dependent approvals, and prevent cross-account access while the correction is investigated. Do not roll back by moving ambiguous data to a guessed account.
- Retain before/after counts, mapping decisions, backup/restore evidence, test identity cases, failures, operator approvals, and final status. Communicate partial/failed migration truthfully; never report completion while records are quarantined or not verified.

## 10. Acceptance criteria and required tests

These are required future tests, not tests run or passed for this document.

### Identity and SSO

- Two synthetic accounts receive distinct, stable, PARMAR-generated IDs; changing email, phone, method, device, or product does not change account identity.
- Client-supplied account/user/role/owner/grant fields cannot affect the resolved principal. Unknown, duplicate, conflicting, expired, replayed, wrong-audience, or unavailable identity denies without resolving to another account.
- No matching-attribute auto-link or merge path exists. Linking, if separately approved, fails without fresh proof and explicit user action.
- After topology approval, end-to-end tests prove one PARMAR account is recognized across approved products, with distinct audience/product authorization and no separate product credentials, browser credential sharing, or cross-product resource permission.
- Logout/revocation and pending-approval revalidation meet an explicitly approved measured latency; no numeric latency is approved by this baseline.

### VOKKI route and resource authorization

- Route-census coverage is **100%** of application path/method handlers and sensitive resource operations in Section 5 and Section 6. A changed/unlisted route fails the release check until its matrix row and tests are reviewed.
- Test at least two accounts, two profiles per account, two workspaces, an owner, a workspace OWNER/ADMIN/MEMBER, an explicit grantee once grants are approved, an unrelated account, and a revoked/expired grantee.
- For each matrix row, test missing/invalid/revoked session, forged client identity, wrong owner/resource ID, wrong active profile, membership-only access, explicit permitted operation, operation escalation, stale/revoked grant, missing consent, service failure, and malformed route/input as applicable.
- Until sharing is separately approved, membership-only, admin-only, and unrelated users produce **zero** personal profile/conversation/memory/file records and **zero** mutations. After approval, grant tests prove only the explicitly mapped operation succeeds.
- Test GET read-only behavior, CSRF/origin denial on unsafe methods, non-enumerating 404 for guessed private IDs, fail-closed storage/policy outages, and no state change on denial.
- `POST /api/analyze`, `/api/chat`, and `/api/approval` tests prove unauthenticated flows cannot persist private data, create usable approvals, access account memory, or execute protected actions. Public/local demo remains clearly distinct and cannot egress externally.
- For memory, verify owner-only list/create/update/delete/clear, consent-required create/update, and no automatic profile/workspace migration. Export/reset/deletion claims require data-class and backup/provider-copy evidence beyond the current route surface.

### Desktop and Android

- Desktop isolation acceptance meets every condition in Section 7 on each declared supported OS and artifact; zero PARMAR credentials, tokens, cookies, identity capabilities, or credential-bearing requests are observed in browser content. Remote browsing remains disabled during verification and after any failed/incomplete gate.
- Android merged-manifest/dependency inspection and observed offline test show no `INTERNET`, WebView/browser engine, networking, remote auth/SSO, service call, or external request. Local app operation does not require account/network.

### Consent, data protection, and lifecycle

- Deterministic revocation-race tests meet M-02's zero-egress and truthful-status outcomes. Provider outage, missing consent, cancellation, and retry never cause silent fallback.
- Production data/backups are not enabled until actual encryption, key custody/rotation/recovery, residency, backup/restore, retention, deletion, account closure, and support-access evidence is independently accepted.
- Closure tests verify session/device/approval revocation, per-data-class status, backup/provider-copy exceptions, disconnected-device limits, idempotent retry, and no standing support access.

### Evidence integrity

Every acceptance record names its requirement/finding, owner, independent reviewer, exact source revision and artifact, platform/runtime, command/environment, expected and actual result, pass/fail/skip, and residual limitations. Test files or proposed procedures are not results. No test, build, device, provider, or runtime verification is claimed by this document.

## 11. Deferred decisions and explicit approval gates

No deferral below changes an approved IT/D outcome. A dependent capability remains disabled until its own gate has a recorded decision and accepted evidence.

| Gate | Decision owner(s) required | Approval/evidence required before dependent work |
|---|---|---|
| **G0 — Scope and authority** | Product decision owner; PARMAR Core owner | Confirm one PARMAR account, no separate product accounts, product/resource authorization separation, parallel VOKKI/AETHER ownership, and exact capability scope. No D-02 or IT decision is changed implicitly. |
| **G1 — Authentication method/provider** | Product, security, privacy/legal, operations | Provider-neutral requirements; documented candidate comparison; explicit security approval before provider/protocol selection, test tenant, account mapping, or integration. Until then production authentication is off. |
| **G2 — SSO/session topology** | PARMAR identity owner; product owners; security; operations | Approve account resolution/mapping, product audiences, handoff/assertion properties, replay/expiry behavior, session issuance/storage, logout/revocation propagation, recovery, outage/reauth behavior, and no shared broad product/browser credentials. No topology is presumed here. |
| **G3 — Authentication assurance and lifecycle** | Security; product; privacy/legal; support/operations | Approve enrollment, passkeys/additional verification, recovery, attempt limits/anti-enumeration, lost-device handling, session lifetime/rotation, device inventory, step-up triggers, closure, notifications, and measurable revocation targets. |
| **G4 — VOKKI authorization and sharing** | VOKKI data owner; PARMAR authorization owner; product/security/privacy | Approve complete route/resource matrix, owner predicates, public exceptions, workspace membership semantics, operation-to-View/Edit/Manage map, grant expiry/revocation, Manage/delegation, export policy, and cross-user tests. Sharing stays disabled until complete. |
| **G5 — Desktop authenticated control plane** | AETHER product/platform owner; independent security reviewer; PARMAR identity owner | Approve per-platform process/origin/session/store design, IPC inventory, threat model, supported OS matrix, independent test observer and NO-GO criteria. Does not approve remote browsing. |
| **G6 — Android boundary change, if ever requested** | AETHER product owner; Android platform owner; security/privacy | Current approval is **none** for networking, `INTERNET`, WebView, remote authentication, online SSO, or service calls. A future proposal requires a distinct explicit decision and offline-contract/security review; do not infer approval from shared SSO. |
| **G7 — Migration and data protection** | Data owner; privacy/legal; security; operations | Approve owner verification, mapping ledger, retention/deletion, encryption/key/residency/recovery, backup/restore, rollout/rollback, data-owner consent and independently tested dry run. No migration before approval. |
| **G8 — External AI and consent** | Product; privacy/legal; security; operations | Separately approve provider/model/region/terms, data classes, purpose/scope consent, race ordering, minimization, transport, zero-egress denial, revocation, and no-fallback evidence. No external provider is selected or enabled here. |
| **G9 — Production and release** | Product, security, privacy/legal, platform, operations, accountable release authority | Exact deployed topology, passed tests without unexplained skips, independent security/privacy review, incident/recovery ownership, rollback, evidence provenance, and signed release scope. No production-readiness claim before this gate. |

Also deferred: detailed family/guardian/team policies, invitations, workspace roles, grant UX and delegation, export formats, consent UX/versioning, retention/deletion SLAs, audit retention, support exceptions, disconnected-device behavior, external AI provider terms, local AI runtime/licensing/update ownership, and offline cache/sync conflict semantics. These remain deferred as recorded in the ADR/PRD; this baseline does not silently select values or authorize dependent capabilities.

## 12. Approved-decision preservation

This baseline does not amend, supersede, or downgrade any approved decision. The final ADR remains authoritative for:

- **IT-01–IT-05:** immutable PARMAR account ID; provider selection deferred; fresh-proof optional linking/no automatic merge; secure recovery/abuse protections; per-device sessions, inventory, logout and step-up.
- **IT-06–IT-08:** personal/multiple-profile/family-team eventual scope with separate enablement gates; workspace membership does not grant personal content; owner-controlled profiles with explicit revocable View/Edit/Manage grants.
- **IT-09–IT-12:** user-scoped memory by default; user lifecycle controls and truthful deletion/consent reporting; production encryption/key/residency/recovery requirements; scoped explicit external-AI consent, minimization and no silent fallback.
- **IT-13–IT-15:** PARMAR-managed AI as a gated long-term goal; offline drafts/cache only under approved scope with server reauthorization, explicit conflicts and no side-effect replay; secure closure/revocation/truthful lifecycle/no standing support access.

The PRD's **D-01–D-13** remain unchanged: web-first with independent platform gates; one PARMAR-wide account/SSO with strict isolation; hybrid AI with explicit consent and no silent fallback; user-controlled memory; explicit user-initiated camera capture; multilingual voice with wake-word separately gated; visual-quality directions with renderer open; PARMAR Core governance for actions; offline drafts/controlled sync without side-effect replay; WCAG 2.2 AA and multilingual quality targets; research provenance and independent verification; PARMAR-managed AI plus evaluated external models with choices open; and user-controlled customization preserving canonical identity and asset controls.

Approval of an outcome is not implementation, provider, schema, operational, security, or release acceptance. Existing evidence and gates are recorded in [VOKKI-IDENTITY-TENANCY-TRACEABILITY.md](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md), [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md), and the [historical approval review](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md); the final ADR supersedes its blank questionnaire fields.

## 13. Implementation dependency order

This is a dependency order for separately authorized future tasks; it is not permission to start production authentication.

1. **Preserve and approve scope:** retain all IT/D decisions and current safe states; assign product, identity/data, security, privacy/legal, platform, operations, and release owners.
2. **Approve provider-neutral contracts:** define immutable account/method mapping, lifecycle, principal claims, product audiences, session and failure interfaces without selecting a provider or transport.
3. **Complete VOKKI perimeter:** census all routes/resources; approve owner/public/demo boundaries, denial semantics, workspace rules, and grant operation mapping. Keep sharing disabled while any item is unresolved.
4. **Approve authentication and SSO topology:** complete G1–G3 reviews and obtain explicit recorded decisions before any provider selection or implementation.
5. **Implement and test owner-only authorization first:** synthetic identities only; fail-closed API enforcement, route census, profile/workspace isolation, CSRF/origin, and route-by-route negative tests. Do not enable production auth in this documentation task.
6. **Approve optional sharing separately:** after operation map and cross-user tests pass, implement only the expressly approved resource grants; membership-only access remains denied.
7. **Approve Desktop control-plane isolation independently:** complete G5 design and per-platform independent acceptance before a PARMAR-authenticated Desktop surface. Maintain remote-browsing NO-GO throughout.
8. **Approve data migration and protection:** complete mapping, owner verification, dry-run, backup/restore, encryption/key/residency, and rollback gates before any production data mutation.
9. **Approve consent/egress and lifecycle:** complete G7–G8 before persistent production data, external AI transfer, export/deletion/closure claims, or offline synchronization.
10. **Independent production/release review:** execute the agreed acceptance suite on exact deployment/platform artifacts, document residual risks, and obtain accountable release sign-off. Android remains offline-only unless separately re-decided.

## 14. Remaining blockers and evidence limits

### Remaining blockers

- No approved provider/protocol or production account registry/mapping/SSO topology.
- No production authentication, recovery/passkey/abuse baseline, complete session/device policy, or release approval.
- No implemented, route-complete VOKKI authorization matrix or approved detailed workspace/grant policy; cross-user sharing remains disabled.
- No verified legacy owner-mapping/migration procedure or approval.
- No approved Desktop control-plane credential store/process topology or independent all-platform isolation acceptance; `REMOTE_BROWSING_ENABLED=false` remains mandatory.
- No authority to add Android networking or online SSO; Android remains offline-only.
- No approved external provider/consent-race implementation or egress acceptance.
- Production encryption/key/residency/backup/recovery, data lifecycle, account closure, support-access, and operational evidence remain incomplete or unverified.

### Evidence limits

Repository inspection confirmed handler structure, owner-scoped repository primitives, existing Desktop partitioning and current isolation limitations, and the Android manifest/offline-contract sources. It does not prove deployed behavior, all packaged manifests, all-platform process/storage isolation, successful test execution, production encryption, or zero network activity. No test, build, device/runtime check, provider flow, security test, migration, or deployment verification was run for this baseline.

## 15. Source evidence index

| Finding/claim | Inspected evidence |
|---|---|
| Review findings and their exact stated evidence | [PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md](./PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md#L61) through [review validation and gates](./PARMAR-IDENTITY-ARCHITECTURE-REVIEW.md#L216) |
| Logical architecture and deferred topology | [PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md#L20), [trust boundaries](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md#L75), [browser/native storage](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md#L272), [Android/Desktop boundary](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md#L303), [gates](./PARMAR-IDENTITY-ARCHITECTURE-SPECIFICATION.md#L417) |
| Approved IT requirements and SSO | [VOKKI-IDENTITY-TENANCY-ADR.md](./VOKKI-IDENTITY-TENANCY-ADR.md#L39), [PARMAR-wide SSO](./VOKKI-IDENTITY-TENANCY-ADR.md#L129), [traceability matrix](./VOKKI-IDENTITY-TENANCY-TRACEABILITY.md#L14) |
| Historical approval status and required ordering | [VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md#L1), [gates and route matrix prerequisites](./VOKKI-IDENTITY-ADR-APPROVAL-REVIEW.md#L261) |
| Product D-01–D-13, route/auth requirements, and safe defaults | [VOKKI-MASTER-PRD.md](./VOKKI-MASTER-PRD.md#L101), [decision register](./VOKKI-MASTER-PRD.md#L1134), [security route gate](./VOKKI-MASTER-PRD.md#L556) |
| Parallel workstream and integration gates | [PARALLEL-DEVELOPMENT-MASTER-PLAN.md](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L18), [V2 identity/route perimeter](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L296), [integration gates](./PARALLEL-DEVELOPMENT-MASTER-PLAN.md#L409) |
| Cross-product implementation gaps and migration risks | [PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md](./PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md#L1), [authorization and data boundaries](./PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md#L68), [migration and acceptance](./PARMAR-IDENTITY-CROSS-PRODUCT-GAP-ASSESSMENT.md#L157) |
| Actual VOKKI HTTP routes, principal resolution and CSRF | [`futuristic_app.py`](./interface/futuristic_app.py#L436), [GET dispatch](./interface/futuristic_app.py#L689), [POST dispatch](./interface/futuristic_app.py#L952), [pending approval ownership](./interface/futuristic_app.py#L251) |
| Existing principal/session primitives and the Task 37 non-production account-registry foundation; no production authentication or provider mapping | [`identity.py`](./identity.py#L17), [`sessions.py`](./sessions.py#L32), [`identity_store.py`](./identity_store.py) |
| Existing VOKKI workspace association, not explicit grants | [`identity_store.py`](./identity_store.py#L175), [profile/workspace association and listing](./identity_store.py#L376) |
| Existing owner-scoped conversation and nullable profile evidence | [`conversations.py`](./conversations.py#L90), [nullable profile migration](./conversations.py#L665), [owner/profile repository predicates](./conversations.py#L875) |
| Existing user-scoped memory/consent evidence | [`memories.py`](./memories.py#L432), [owner-filtered records and consent](./memories.py#L472) |
| External authorization is not user consent; no fallback routing | [`readiness.py`](./chat/readiness.py#L274), [`router.py`](./chat/router.py#L18) |
| Desktop browsing deny, persistent partitions, preload/IPC, and process boundaries | [`security.cjs`](./desktop/security.cjs#L5), [`profiles.cjs`](./desktop/profiles.cjs#L1), [`profile-partitions.cjs`](./desktop/profile-partitions.cjs#L8), [`browser-preload.cjs`](./desktop/browser-preload.cjs#L1), [`browser-child-supervisor.cjs`](./desktop/browser-child-supervisor.cjs#L79), [`browser-child-broker.cjs`](./desktop/browser-child-broker.cjs#L16), [`main.cjs`](./desktop/main.cjs#L1285), [browser window](./desktop/main.cjs#L1347), [control window](./desktop/main.cjs#L1480), [`ISOLATION-READINESS.md`](./desktop/ISOLATION-READINESS.md#L1) |
| Android offline boundary and unverified persistence | [`AndroidManifest.xml`](./android/app/src/main/AndroidManifest.xml#L1), [`AETHER-MOBILE-OFFLINE-CONTRACT.md`](./AETHER-MOBILE-OFFLINE-CONTRACT.md#L9), [`PERSISTENCE-ARCHITECTURE.md`](./android/PERSISTENCE-ARCHITECTURE.md#L1) |

---

**Change boundary:** This is the single new architecture document for Task 35. No existing file is changed or deleted. No source code, schema, configuration, test, workflow, provider, production authentication, network capability, or migration is introduced.
