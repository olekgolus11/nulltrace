# macOS credential companion foundation

This package implements a small internal target-context credential-record layer for a future user-level macOS companion. It uses generic-password items through Security.framework and exposes only typed record kinds, UUID record IDs, schema version 1, bounded JSON payloads, and expected-generation save/delete operations. The Security backend derives separate account namespaces for target context, provider login, and raw-evidence-key kinds. Only target-context payloads are currently accepted; provider and evidence payload integration is not implemented. Reads never enumerate Keychain items or accept a caller-provided Keychain service/account/query.

Target payloads require a normalized HTTP(S) origin with a canonical hostname or IPv6 literal and a valid explicit port. They accept bounded cookie, header, and browser-storage maps. Header and cookie names must use RFC token characters; header values and cookie paths reject control characters, cookie values use the RFC cookie-octet subset, cookie booleans and expiry values have exact JSON types and bounded ranges, and cookie domains must match the origin host. Empty hosts, noncanonical origins, unknown fields, and unknown schemas are rejected. Loopback reachability is not evaluated here and must be controlled by the authenticated operation's network policy. The helper-owned Keychain envelope stores a monotonically increasing generation and a deletion tombstone. Delete overwrites the record payload with the tombstone; it does not call `SecItemDelete` and makes no claim about physical erasure. A stale write cannot recreate the cleared payload. Failures distinguish invalid input, conflict, not-found, unavailable/locked, denied, corrupt data, and other backend errors without including record contents. Encoded records are size-checked before decoding.

The package has no executable, listener, enrollment protocol, application identity source, transport, or launcher. Its internal backend construction must be owned by the trusted companion and supplied an enrollment-owned installation UUID; the UUID is not proof of authorization. Authenticated encrypted transport, mutual identity verification, single-owner process enforcement, packaging/signing, and application adapter work are prerequisites to activation. Actor serialization applies only to calls through one store instance. Security.framework does not provide compare-and-swap across independent helper processes, so this foundation is not safe to activate until an external single-owner mechanism is implemented and qualified; it does not claim cross-process CAS.

Tests inject an in-memory backend containing synthetic values. They do not access the user's Keychain or credentials. The package is a bounded implementation prerequisite, not a security qualification or completion of issue #162.

Run checks on macOS with:

```sh
swift test
swift build
```
