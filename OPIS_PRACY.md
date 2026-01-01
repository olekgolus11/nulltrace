Wykorzystanie dużych modeli językowych jako wsparcia w testach penetracyjnych stron i aplikacji webowych 

Cel pracy 

Praca magisterska ma na celu weryfikację czy duże modele językowe są w stanie wesprzeć pentesterow w testach penetracyjnych, a jeżeli tak, to w jakim stopniu. Jest ona przeznaczona zarówno dla początkujących (dzięki konwersacyjnemu prowadzenia “za rączkę”) jak i dla średnio-zaawansowanych pentesterów, potencjalnie przyspieszając im pracę. Narzędzie, które będzie wytwarzane w ramach części projektowej, ma na celu realizować 3 główne cele.  

Po pierwsze, ma automatycznie uruchamiać rekonesans (nmap, subfinder, wappalyzer i inne do sprawdzenia). Ma to na celu przyspieszyć start pentestowania, czyli w momencie uruchomienia narzędzia od razu uruchamiamy pierwsze skany które mają na celu przygotować “fundament”. Dostajemy od razu sitemapę, subdomeny, i inne. Możemy już na tej podstawie coś "budować”. 

Po drugie, ma na zawołanie użytkownika realizować skany podatności (sqlmap, nuclei, npm audit, zap baseline scan i inne do sprawdzenia). Będąc już po pierwszym kroku (czyli po fazie rekonesansu) mamy wskazane już potencjalne ścieżki, które możemy próbować skanować, poszukując najbardziej popularnych luk bezpieczeństwa (do uzupełnienia jakich). 

Po trzecie, najważniejsze, ma umożliwiać konwersacyjne podejście do pentestow, czyli LLM zbiera kontekst o całej aplikacji, który przechowujemy w plikach/bazie, i dajemy użytkownikowi rozmawiać i planować pentesty wspólnie z asystentem. Asystent wzbogacony o kontekst ze znalezisk wraz z użytkownikiem może proponować plan i sekwencje ataku oraz może pomóc analizować wyniki różnych skanów (potencjalnie prowadząc do kolejnych podatności). 

To co jest bardzo ważne - platforma realizowana w ramach projektu nie ma odkrywać koła na nowo. Ma ona wykorzystywać istniejące już i dobre, sprawdzone narzędzia, i ma zbierać je w jedną, spójną całość. Można powiedzieć że będzie to narzędzie inteligentnie orkiestrujące istniejące już narzędzia. 

Wymagania 

Platforma musi udostępniąć możliwość wykonywania autoryzowanych zapytań, ponieważ bardzo duża ilość ataków wymaga bycia zautoryzowanym na danej stronie. Użytkownik korzystający z platformy będzie musiał albo przekazywać token autoryzacyjny, albo w bezpieczny sposób podawać hasło i login. 

Platforma musi być orkiestrowana przez użytkownika. Użytkownik musi ingerować w pentesty, potencjalnie pomagać z właśnie autentykacją, captchą i innymi mechanizmami które wymagają ingerencji człowieka. Oprócz tego użytkownik powinien przekazywać intencje tego co chce zrealizowac, czy próbuje zbadać konkretny moduł strony, czy poszukuje potencjalnych miejsc do ataku.  

Platforma powinna udostępnić modelowi językowemu używanie podstawowych tooli, pokroju kalkulator, czy czy bardziej zorientowanych na pentesting np. keygen, JWT generator, hash generator, hash lookup table. Musi ona również posiadać narzędzie do scrapowania strony, może być to playwright i cheerio albo firecrawl. Do zastanowienia jest możliwość generowania i uruchamiania własnych skryptów w pythonie. To mogłoby znacząco zwiększyć pole zastosowań platformy, ale może być bardzo trudne w realizacji. Podjąłbym się tego jeżeli starczy mi czasu. 

Platforma powinna być uruchamiana w bezpiecznym środowisku, najlepiej w dockerze, z wszystkimi już wymaganymi toolami, tak by użytkownik nie musiał martwić się o bezpieczeństwo swojego systemu, oraz by ułatwić setup całej aplikacij. 

Platforma będzie składać się z trzech głównych modułów - warstwa prezentacyjna w TUI (Terminal User Interface), warstwa logiczna (LLM orkiestrujący narzędziami) oraz warstwa wykonawcza (czyli serwisy odpowiedzialne za uruchamianie i zarządzanie narzędziami). 

 

 