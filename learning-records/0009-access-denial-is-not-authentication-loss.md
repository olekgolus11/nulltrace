# Odmowa dostępu nie oznacza utraty uwierzytelnienia

Użytkownik rozpoznał, że odpowiedź `403` opisuje brak dostępu do konkretnego zasobu, a nie ważność całej sesji. Crawler powinien zapisać taką obserwację, pozostawić URL jako odwiedzony i kontynuować; usunięty mechanizm selektywnego retry nie powinien być zastępowany przez fałszywe `authentication_required`.

## Evidence

Użytkownik prześledził sekwencję `GET 403` + potwierdzający `HEAD 403`, zidentyfikował fałszywe zatrzymanie całego crawla i samodzielnie usunął `403` z `isAuthenticationSignal`, zazieleniając test regresyjny.
