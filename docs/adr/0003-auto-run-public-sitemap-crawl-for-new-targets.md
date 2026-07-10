# Auto-run public sitemap crawl for new targets

NullTrace automatically starts one public sitemap crawl when the operator opens the first testing session for a new target, and concurrent sessions for that target share the same running crawl instead of starting duplicates. This deliberately differs from scanner action drafts, which require operator approval before execution, because public sitemap discovery is target-level foundation data used by the dashboard and chat context rather than a per-session finding scan; authenticated crawling remains separate future work.
