# Broker credential generation revocation foundation

Status: broker-side foundation implemented; trusted application authority wiring and authenticated tool activation remain pending.

## Authority and receipt binding

An authenticated execution profile is one whose mode starts with `authenticated-` or whose installed profile declares a secret input slot. The broker requires an injected `ExecutionCredentialAuthority` for these plans. Its trusted `resolveBinding` receives the authenticated broker principal, authorization ID and the complete validated plan, and returns an opaque scope ID plus the durable context generation. No session ID or generation is accepted from the execution caller or plan. The broker checks the authority's current-generation lookup during preparation, after input delivery and immediately before the durable start commit.

The receipt journal stores only the opaque scope ID, generation and a revocation bit. These values are excluded from plans, secret input, argv, environment, labels and logs. Receipt matching also includes an installation-scoped keyed owner, allowing a trusted invalidation to reach the same context's executions after an application instance restart while keeping another installation's records separate. Legacy active generation zero is supported.

The authority is a broker-construction dependency only. No execution bearer or administrator HTTP route can issue, edit or revoke a binding. The current daemon remains configured for public profiles and has no authority adapter, so authenticated execution fails closed until a trusted application boundary is wired. In particular, the same-user administrator socket is not treated as a distinct OS principal, and this foundation does not add secret acceptance to the administrator API.

## Revocation and start ordering

A trusted caller invokes `revokeCredentialGeneration` when a context generation is replaced or cleared. The broker durably flags all matching pending receipts for that installation before it waits for any input write or runtime setup. It requests cancellation for every active matching execution immediately. Prepared inputs are drained, discarded and then closed; failed or uncertain destruction leaves an interrupted receipt that blocks admission. New prepare, input sealing and start operations reject the revoked or no-longer-current generation.

At the commit-to-start boundary, the broker and revocation method perform their checks and receipt updates synchronously against the same journal. A committed start is invoked in the same event-loop turn, so the supervisor has registered its abort controller before a later invalidation can run. The runtime cancellation adapter must synchronously latch cancellation before returning; the broker repeats cancellation after an in-progress start setup settles if cleanup remains pending. A cancellation request is not cleanup confirmation.

The HTTP network runtime stops the run's Squid proxy and verifies that it is no longer running before removing the worker. Stopping the proxy removes the only worker route to external egress. If proxy stop cannot be confirmed, the runtime attempts scoped emergency removal, reports cleanup as uncertain and blocks further starts pending reconciliation. Reconciliation stops role-labelled proxies and checks legacy owned container names before removing owned resources. It never prunes resources outside the installation's labels.

## Integration handoff and limits

The durable authentication-context generation store currently has no subscriber to the broker. The application integration must call revocation as part of clear/replace and provide an authority that resolves the grant to the protected installation/session scope. It must not make the caller-provided session ID or generation authoritative. Each migrated authenticated tool must use a profile that declares its secret slot or authenticated mode and must retain its existing exact-origin and consent checks.

This change does not qualify the native companion, same-user process separation, authenticated cURL/Auth Check behavior, Docker Desktop cleanup, physical secret erasure, or recovery while the engine is unreachable. A secret already sent to the approved target cannot be recalled. Public plans have no credential binding and are not selected by a generation revocation.
