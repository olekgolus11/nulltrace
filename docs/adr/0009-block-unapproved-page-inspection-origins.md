# Block unapproved page inspection origins before contact

Status: planning decision under the operator's 2026-09-20 direction and delegated completion; implementation and qualification pending.

Page inspection initially permits network contact only with the testing target's exact normalized HTTP(S) origin. This deliberately replaces the current cross-origin script/style/font/image exception. Unapproved requests are blocked before connection, and inspect_page returns the available partial snapshot with bounded sanitized blocked-destination information. A failed main navigation must not be fabricated as a successful page snapshot.

An additional, separately implemented workflow may let the operator select auxiliary resource origins from observed blocks. The assistant can explain likely purpose and uncertainty; it cannot approve an origin or trigger an unapproved probe. Default selections are empty. Grants are scoped to page-inspection resources in the current testing session, with an immutable policy version for each execution, not scanner scope or authentication scope. They do not enable main navigation, frames, popups, WebSockets, service workers, downloads or credential forwarding to the added origin.

The default chosen under delegation is auxiliary resources only. Cross-origin standalone pages and SSO are outside this implementation; expanding those requires a later explicit decision. New grants apply to a new inspection environment, never by mutating an active worker's firewall. Revocation cancels executions using the removed grant. Exact-origin authentication remains unchanged under ADR 0007.

Retain browser request controls, but enforce endpoint limits independently. Non-MITM Squid cannot distinguish HTTPS image/fetch/navigation traffic inside a permitted tunnel. Safe auxiliary delivery in authenticated inspection needs a separate credential-free resource boundary; do not implement it by trusting a route header override to strip cookies. See the [Playwright handoff](../design/isolation/playwright.md).
