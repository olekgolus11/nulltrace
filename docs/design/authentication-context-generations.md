# Authenticated request context generation persistence

Status: bounded prerequisite for #162. This protects the application's saved request context across replacement, clear, restart, and overlapping storage operations. It does not implement the native companion, activate authenticated isolated workers, or complete #162.

## Durable authority

SQLite stores one nonsecret state row per session: a monotonically increasing generation, lifecycle state (`saving`, `active`, `clear_pending`, or `cleared`), and storage mode. It also stores a generation-only ledger for protected-store keys and their deletion state. The state and ledger contain no cookies, headers, browser-storage values, serialized context, or hashes. Metadata remains redacted and is tagged with its context generation; reads and Auth Check updates are accepted only while that same generation is active.

Before a replacement starts its asynchronous store write, the service advances the generation, hides old metadata, and notifies each invalidation subscriber. The protected payload is written to a generation-specific key and carries the same generation. The service activates it only if that generation remains current and the returned storage mode matches on read. A delayed write or delete can therefore affect only its own key; it cannot overwrite or remove a later generation. Legacy version 1/2 payloads can be adopted at generation zero only when no durable state row exists. A tracked mutation creates the tombstone first, so legacy data is never used as a fallback afterward.

Clear advances the durable generation and removes visible metadata before waiting for the platform store. The service marks the state `cleared` only after all tracked older keys have confirmed deletion and no tracked writer remains. Unavailable stores, failed deletes, and ambiguous receipts leave `clear_pending`; loading continues to return no context. Reads and later explicit clears retry known pending deletions in batches of at most 256 keys, for up to four batches per attempt. Retries stop when a batch makes no deletion progress; remaining work stays pending for a later access or explicit clear. Platform-specific “not found” exit codes are not guessed to mean confirmed deletion.

## Limits of this stage

An interrupted `saving` operation leaves its generation marked as an unresolved writer. This stage keeps such state blocked and refuses to confirm a later clear while that writer is unresolved. It cannot prove that a different live process will not finish the write; companion-owned compare-and-swap and process identity are future work. A process-memory replacement remains marked `memory`; after restart it cannot promote an older secure-store value to the new generation, and the missing memory value is unavailable.

The version check prevents an Auth Check already in flight from writing results after a context replacement. Scanner-supplied credentials do not yet carry their originating generation, so a separate scanner call that begins later with previously captured credentials is outside this change. Invalidation subscribers are notified synchronously, but no production scanner subscriber is currently wired; this change does not claim active-run revocation. The existing macOS Keychain adapter's save transport is also unchanged and remains native-companion work.
