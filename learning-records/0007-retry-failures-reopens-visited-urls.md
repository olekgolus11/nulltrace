# Retry przywraca nieudane URL-e do wykonania

Status: superseded by LR-0009

Użytkownik rozpoznał, że timeouty i błędy serwera oznaczają niedokończoną próbę, a nie skutecznie odwiedzoną stronę. W trybie `retry_failures` crawler usuwa odzyskane URL-e z `visited`, ponieważ zostały one oznaczone jako odwiedzone przed fetchowaniem i bez tego zostałyby pominięte przez główną pętlę.

## Evidence

Wyjaśnienie warunku `mode === "retry_failures"`, 2026-07-19.
