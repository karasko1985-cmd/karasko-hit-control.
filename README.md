# KARASKO HIT CONTROL

Responsywna aplikacja internetowa do automatycznego pisania, oceniania i poprawiania pełnych polskich tekstów do Suno.

## Uruchomienie lokalne (Windows / Mac / Linux)

1. Zainstaluj Node.js 20 lub nowszy (zalecany Node.js 22 LTS).
2. Skopiuj `.env.example` jako `.env` i wpisz `OPENAI_API_KEY` oraz mocne `APP_PASSWORD`.
3. Otwórz terminal w katalogu aplikacji i uruchom `npm start`.
4. Otwórz `http://localhost:3000`. Gdy przeglądarka poprosi o dane, nazwa użytkownika może być dowolna, a hasło to `APP_PASSWORD`.
5. Na telefonie w tej samej sieci Wi-Fi: `http://ADRES_IP_KOMPUTERA:3000` (kopiowanie przez schowek może wymagać HTTPS).

## Publikacja w internecie

Umieść folder w repozytorium prywatnym, połącz z hostingiem Node.js (np. Render, Railway, Fly.io lub własny VPS), ustaw zmienne środowiskowe `OPENAI_API_KEY`, `APP_PASSWORD`, `OPENAI_MODEL` i uruchamiaj poleceniem `npm start`. Włącz HTTPS. Nie umieszczaj klucza w kodzie frontendu ani w repozytorium.

**Uwaga:** projekt jest gotowy do uruchomienia, ale nie został opublikowany na hostingu. Nie zawiera konta API ani darmowych środków na API. Płatności za API są osobne od abonamentu ChatGPT i Suno. Aplikacja nie generuje muzyki i nie łączy się z Suno.

## Zasady kosztów

`MAX_AI_CALLS` ogranicza liczbę wywołań na jedną piosenkę (2–8, domyślnie 6). Typowo: tworzenie, ocena, poprawa, ocena, poprawa, ocena. Dodatkowo: 15 sekund odstępu między uruchomieniami z jednego IP i maksymalnie dwa równoległe zadania. Są to limity techniczne, **nie twardy limit wydatków w USD**. Ustaw osobny limit budżetu i alerty w panelu dostawcy API. `INPUT_USD_PER_M` i `OUTPUT_USD_PER_M` służą do orientacyjnego wyliczenia kosztu według ręcznie podanych stawek; przy wartości 0 koszt nie jest szacowany. Model może zmieniać ceny, a raport tokenów może nie obejmować wszystkich składników opłat.

## Ocenianie

Sześć kategorii: rymy, flow, naturalność, refren, historia, oryginalność. Próg 9/10 dotyczy wszystkich sześciu ocen. Jeśli limit wywołań zostanie osiągnięty, aplikacja pokazuje wynik nawet poniżej progu i uczciwie go oznacza. Oceny AI nie są gwarancją jakości, sukcesu komercyjnego ani rzeczywistego flow po wygenerowaniu wokalu. Wymagana jest ludzka kontrola.

## Dane i bezpieczeństwo

Klucz API znajduje się wyłącznie na serwerze. Teksty są przesyłane do OpenAI API. Historia ostatnich 15 wyników jest przechowywana tylko w pamięci procesu (znika po restarcie). Przy wystawieniu publicznym wymagane są mocne hasło, HTTPS i ograniczenie dostępu. HTTP Basic bez HTTPS nie chroni hasła w transmisji. Nie udostępniaj `.env`.

## Automatyczny dobór tekstu i stylu (v1.1)

Domyślnie włączone jest **AI SAMO DOBIERA TEMAT, TEKST, STYL I BPM**. Osobne wywołanie modelu ustala koncepcję, gatunek, BPM, klimat, wokal i produkcję; następne pisze pełny tekst i Style, a redaktor ocenia oraz poprawia. Podany temat jest wskazówką; puste pole pozwala AI wybrać temat. Wyłączenie przełącznika odblokowuje ręczne ustawienia. Tryb automatyczny zużywa co najmniej jedno dodatkowe płatne wywołanie API w ramach MAX_AI_CALLS.
