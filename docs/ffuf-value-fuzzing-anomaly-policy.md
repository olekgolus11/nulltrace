# FFUF Value Fuzzing Anomaly Policy

Value Fuzzing tests one named query, body, or header parameter on one exact-origin endpoint.
Every valid FFUF match remains in the bounded `ffuf_value_fuzzing` artifact. A match becomes a
Finding only when one deterministic policy rule below applies.

## Finding rules

- `server_error`: HTTP 500–599 combined with an injection-style payload marker (SQL control
  syntax, script markup, path traversal, template expression, or `/etc/passwd`). Severity:
  `medium`.
- `external_redirect`: HTTP 300–399 where the response `Location` resolves to the same external
  origin supplied as an absolute-URL payload. Severity: `medium`.

HTTP differences without one of these correlations, ordinary matches, malformed records, and
inconclusive size, word, or line differences remain artifact context only.

## Fingerprints and review state

Finding fingerprints use source tool, anomaly kind, query-free endpoint, request location, and
parameter name. Payload changes and scanner reruns therefore update the same scanner observation.
The shared Finding repository supplies effective `needs_review` when no review exists and stores
operator review state separately, so reruns cannot overwrite confirmed or dismissed reviews.

## Evidence bounds and redaction

Artifacts preserve at most 200 parsed results. Payloads are limited to 256 characters plus a
truncation marker. Values following common secret labels (`Authorization`, cookie, token, secret,
password, and API key) are replaced with `[REDACTED]`. Redirect evidence keeps only bounded origin
and path; endpoint provenance drops query strings. Raw FFUF JSON remains referenced by size and
SHA-256 in the tool artifact source metadata.

Value Fuzzing artifacts are not processed by Target Sitemap enrichment. Generated payload URLs and
payload values therefore never create sitemap entries.
