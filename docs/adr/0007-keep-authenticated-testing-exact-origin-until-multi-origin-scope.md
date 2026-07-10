# Keep authenticated testing exact-origin until Multi-Origin Scope

NullTrace will send a session's authenticated request context only to its target's exact normalized origin in M5, never implicitly to subdomains, alternate ports or schemes, or cross-origin redirects. A future Multi-Origin Scope will let the operator explicitly authorize additional origins and define their authentication rules; this prevents accidental credential forwarding while preserving a path for applications split across web and API origins.
