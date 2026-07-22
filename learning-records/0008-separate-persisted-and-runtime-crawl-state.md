# Stan crawla rozdziela dane wznawialne od sekretów runtime

Użytkownik zdecydował, że stan pojedynczego authenticated crawla powinien mieć jasną granicę między postępem możliwym do zapisania w checkpoincie a stanem wyłącznie runtime. Dzięki temu cookie jar i sygnały uwierzytelnienia nie mogą zostać przypadkowo zapisane razem z frontierem, historią odwiedzin, błędami i licznikami.

## Evidence

Decyzja podczas projektowania czytelniejszych faz `AuthenticatedSitemapCrawler.crawl`, 2026-07-20.
