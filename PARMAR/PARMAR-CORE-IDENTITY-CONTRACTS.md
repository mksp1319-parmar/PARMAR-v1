# PARMAR Core Identity Contracts

Status: provider-neutral code contract only. This document does not approve or
activate production authentication, a provider, cross-product SSO, or account
migration. The architecture and approval gates in
[PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md](./PARMAR-IDENTITY-IMPLEMENTATION-BASELINE.md)
remain authoritative.

## Core contract

`identity_contracts.py` defines immutable `AccountIdentity`, distinct
`ProfileIdentity` and `WorkspaceIdentity` values, provider `(issuer, subject)`
identity, a time-bounded `AuthenticatedPrincipal`, and internal session and
product context types. Account IDs are generated as RFC 4122 UUIDv4 values and
serialize only as canonical lowercase UUID strings. Parsing rejects other UUID
versions and noncanonical strings. UUID equality across identity types does not
make those identities interchangeable.

`AuthenticationAdapter` verifies a provider assertion without choosing a
provider or returning a PARMAR account ID. `ProviderAccountBindingLookup` is
read-only and keyed only by the verified provider identity. An unknown binding
fails closed; there is no account creation, linking, merging, email/name
matching, or provider-to-resource permission path in these contracts.

The Core principal contains the PARMAR account identity and authentication
time/expiry only. Active profile and workspace membership are separate session
context. Missing, malformed, not-yet-valid, or expired principals deny access.
`authorize_resource_access` denies by default and validates owner/profile
context. View, Edit, and Manage have distinct action-coverage semantics, but a
`ResourceGrant` descriptor is not proof of an active or authoritative grant:
the evaluator denies non-owner access even when such a descriptor is present.
Grant lifecycle, revocation, and authority remain deferred. Workspace
membership alone never authorizes a resource; non-owner workspace-resource
sharing remains denied until its policy and approval gates are complete.

`ProductSessionContext` scopes the same Core session identity to a server-chosen
product audience; it contains no bearer token or product permission. Resource
authorization remains a separate product decision. The Home resolver contract
accepts a trusted server request and requests the fixed PARMAR Home audience;
the browser's account/profile/workspace fields are not an authentication source.

## Product boundaries

| Consumer | Contract relationship and current boundary |
| --- | --- |
| **PARMAR Home** | First-class future consumer of the shared account/session contract and the independent central PARMAR workspace. Home is not part of VOKKI or AETHER. Its current SPA reads `/api/session` and profile/workspace APIs; those existing server paths still use the legacy `Principal.user_id` development identity. Task 37 adds an internal account-registry foundation, but there is no approved authentication/account resolver or binding writer from that legacy ID to `AccountIdentity`. Do not equate or migrate those UUIDs. Before production Home identity integration, add an approved server-side account/session resolver and test its ownership/profile isolation. Do not send an account ID from the browser as proof. Home UI changes are out of scope. |
| **VOKKI** | Independent product workspace and future consumer of the same PARMAR account contract. Existing routes still use legacy server-side `user_id` ownership; the new registry is not wired to VOKKI routes and does not migrate those records. A vetted account resolver and the complete route/resource authorization gate remain prerequisites; workspace membership is not a personal-data grant. |
| **AETHER Desktop** | Independent product. Any future identity context belongs to a trusted application/control-plane boundary, not browser content. Browser identity and PARMAR account identity remain distinct. The browser preload exposes no PARMAR account, authentication, session, or token API; remote browsing remains disabled until independent isolation verification. |
| **AETHER Android** | Independent offline product. `AETHER_ANDROID_FUTURE_AUTH` names only a future authenticated architecture audience. It does not activate identity, network access, or online SSO. Preserve no `INTERNET` permission, no WebView, and no networking implementation. |
| **Future PARMAR products** | Use the same Core account identity and a server-selected product audience; they do not create product accounts. Their authorization and integration must be separately reviewed. |

This is a product-facing contract, not a live shared session or SSO flow.
Provider selection, production authentication topology, session handoff,
cross-product logout/revocation, sensitive-action step-up rules, and any
legacy-identity migration remain subject to the explicit approval gates in the
architecture baseline. The current authentication context does not define a
step-up policy for sensitive actions.

## Account registry foundation

The existing `SQLiteIdentityRepository` is extended additively; the registry
does not create another database. Schema version 3 adds an `accounts` table
with a random immutable UUIDv4 account ID, UTC creation timestamp, and
`ACTIVE`/`DISABLED` status, plus a `provider_account_bindings` table with a
unique `(issuer, subject)` key and a restrictive account foreign key. Version 1
profile/workspace data is preserved without assigning any legacy `user_id` to a
PARMAR account. Version 2 registry tables are rebuilt transactionally with
stricter database-level UUID and provider-identity constraints; invalid
existing registry rows abort migration without changing the prior schema.
Database triggers prevent account ID changes and account deletion; unsupported
or malformed records fail closed. Schema migration is additive and does not
provide a destructive downgrade path.
`ACTIVE` is only the registry-record lifecycle state; it does not assert that
the account authenticated or may access any product. No status-transition
operation is exposed.

`TrustedInternalAccountProvisioner` is an internal server-side interface that
mints account IDs; it accepts neither an account ID nor provider claims. It is
not wired to an HTTP route, development login, or an authentication adapter.
It currently has no application caller. This is an internal code boundary,
not an enforced capability or a production-hardened provisioning service:
in-process Python code can construct the provisioner and Python identity
objects are not unforgeable capabilities. Do not activate enrollment until an
approved account-provisioning policy and the applicable authentication,
security, and release gates are satisfied.
`AccountRegistry` exposes only read operations and implements the Task 36
provider-binding lookup contract. There is no binding writer, provider adapter,
active provider flow, or attribute-based linking. The binding table remains
empty until a separately approved authentication adapter and explicit
linking/provisioning policy are implemented. Account creation is a storage
foundation, not production authentication or account enrollment.

Task 36 identity dataclasses, including `VerifiedProviderIdentity` and
`AuthenticatedPrincipal`, are ordinary constructible in-process values. Their
types validate shape and time semantics, not unforgeable authentication
provenance. A future adapter and its callers must remain inside a trusted
server-side boundary and must never treat deserialized client objects as proof.

## Implemented and unimplemented boundary

Implemented code includes typed identity/context contracts; the persistent
account-record and provider-binding lookup foundation; time validity; Home
context projection; permission-level comparison; and a deny-by-default,
owner-only authorization evaluator. Focused tests exercise actual SQLite
creation, lookup, reopen, migration, uniqueness, rollback, and concurrency as
well as the existing HTTP client-identity rejection boundary.

No production provider adapter, account-to-provider binding writer, legacy ID
mapping, Home or VOKKI production account resolver, cross-product token/session
flow, authoritative grant resolver or workspace-sharing policy, Desktop
identity handoff, or Android online identity exists as a result of this
contract. The existing Home server APIs remain development identity APIs until
an approved server-side authentication/account resolver and resource-ownership
integration are implemented.
