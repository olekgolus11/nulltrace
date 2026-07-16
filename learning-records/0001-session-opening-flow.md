# Rozróżnianie routingu, stanu sesji i pracy w tle

Użytkownik poprawnie prześledził ścieżkę utworzenia sesji dla nowego targetu: normalizacja URL, target/sesja w repozytorium oraz przejście do dashboardu. Sam zauważył, że `sessionOpenRequestToken` dotyczy wyścigów asynchronicznego przygotowania rozmów, a `SitemapCrawlCoordinator` jest granicą decyzji o uruchomieniu crawla; kolejne ćwiczenia mogą rozwijać rozumienie odpowiedzialności tych modułów.

## Evidence

Odpowiedź do lekcji 0001, 2026-07-16.
