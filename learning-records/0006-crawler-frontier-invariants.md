# Kolejka crawla i zbiór unikalności mają odmienne role

Użytkownik wyjaśnił, że `queue` przechowuje pełne zadania do wykonania, `visited` strony już odwiedzone, a `queued` zbiór URL-i używany do zapobiegania ponownemu zaplanowaniu tej samej strony. Rozumie również, że po wznowieniu stan jest odtwarzany z checkpointu, dzięki czemu crawler zachowuje tę inwariantę między uruchomieniami.

## Evidence

Wyjaśnienie scenariusza podwójnego odkrycia `/account` i wznowienia crawla, 2026-07-19.
