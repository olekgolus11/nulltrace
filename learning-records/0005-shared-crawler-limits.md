# Wspólny koncept limitów crawlera

Użytkownik rozpoznał, że limity pracy crawlera należą do wspólnego konceptu sitemap crawlera, a nie do implementacji publicznej. Samodzielnie wyodrębnił `SitemapCrawlerLimits` i `defaultSitemapCrawlerLimits`, zachowując odpowiedzialność konkretnych crawlerów za ich własne wejścia i workflow.

## Evidence

Weryfikacja: testy publicznego i uwierzytelnionego crawlera oraz `bunx tsc --noEmit`, 2026-07-19.
