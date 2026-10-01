# Inherited socket peer-token qualification

This note records a test-only platform probe for a possible trusted-launcher bootstrap channel. It does not add a production bootstrap API, enrollment flow, credential store, or companion listener.

On the available arm64 macOS 26.5.2 host (Xcode 26.4 SDK), an inherited `AF_UNIX` `SOCK_STREAM` socketpair supported a one-way check before the child consumed a queued synthetic frame. The child required exact `getsockopt` result lengths and matching audit-token/`LOCAL_PEERPID` PIDs, passed its audit token to `SecCodeCopyGuestWithAttributes`, and validated the guest with a strict `cdhash` requirement. The creator-side diagnostics apply the same length and PID checks and report the creator PID. The test signs temporary copies of a probe executable. A launcher with the pinned code hash was accepted; a different executable signed under the same identifier but with a different code hash was rejected. The rejected child used a nonblocking `MSG_PEEK` and reported the full 24-byte synthetic canary still queued; it consumed zero frame bytes. The accepted child consumed the same 24-byte canary. Temporary files contain no private keys or user credentials.

The check is only one-way. At the creator's endpoint, both `LOCAL_PEERTOKEN` and `LOCAL_PEERPID` identified the creator process itself, not the spawned child. This test therefore does not authenticate the post-exec child to its creator. It does not establish a same-UID security boundary, protect against process-image races, or prove that this behavior is stable on other macOS releases. The kernel implementation resolves the socket's recorded peer PID when queried; do not treat this as a PID-reuse-resistant identity binding. The Security guest lookup behavior is also host-dependent.

The test also attempts an `AF_UNIX` `SOCK_SEQPACKET` socketpair and records status plus errno without requiring a particular platform result. On the current host the attempt failed with `EPROTONOSUPPORT` (errno 43). The qualification uses `SOCK_STREAM`; any future framing protocol would need explicit bounded framing and truncation handling.

The test is reproducible with:

```sh
cd native/macos-credential-companion
swift test --scratch-path /private/tmp/nulltrace-peer-qualification-build --filter CredentialCompanionBootstrapPeerQualificationTests
```

This is evidence for one OS/API configuration, not authorization to use ad-hoc signing in production. Production still needs a release-owned launcher/helper identity, a documented process-authentication channel that covers both directions, and a trusted enrollment and reservation handoff. XPC is a candidate for evaluating message-bound audit-token identity. No production activation should rely on the test fixture's signing identity or on identifier-only checks.
