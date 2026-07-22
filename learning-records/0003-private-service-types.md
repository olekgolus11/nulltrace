# Prywatne typy zależności mogą zostać przy serwisie

Użytkownik rozpoznał, że prywatne interfejsy opisujące zależności konstruktora są nierozłączne z `SitemapCrawlCoordinator` i powinny pozostać nad klasą. W odpowiedzi standard został doprecyzowany, aby wyraźnie odróżniać takie typy od publicznych kontraktów i funkcji pomocniczych.

## Evidence

Uzasadniona decyzja po audycie `sitemap-crawl-coordinator.service.ts`, 2026-07-16.
