# KARASKO HIT CONTROL 2

Polskie teksty z rymami oraz dopasowane instrukcje brzmienia do Suno. Aplikacja tworzy Lyrics, Style i Exclude; gotowe nagranie powstaje w generatorze muzyki.

## Uruchomienie

Wymagany Node.js 20 lub nowszy. Nie ma zewnętrznych zależności.

1. Ustaw istniejący `OPENAI_API_KEY` w panelu hostingu albo lokalnym `.env`.
2. Ustaw `APP_PASSWORD`, jeśli udostępniasz aplikację w internecie.
3. Uruchom `npm start`, otwórz `http://localhost:3000`.

W Render użyj instrukcji HOSTING_RENDER.md. Zachowaj klucz w panelu Render; nie wklejaj go do kodu ani rozmowy.

## Jak działa nowa wersja

- Jeden brief z tematem i preferencjami trafia do producenta, autora i recenzenta. W manualu gatunek, BPM i klimat pozostają stałe.
- Producent porównuje kierunki, dobiera groove, instrumenty, wokal i kontrast sekcji oraz planuje rodziny rymów.
- Autor pisze naturalne polskie wersy, słyszalne rymy, pełne refreny i Style pod faktyczny tekst. Refren może zostać przebudowany, jeśli jest słaby.
- Recenzent sprawdza siedem kategorii, w tym dopasowanie stylu. Musi wskazać cytaty i pary rymów. Niepotwierdzone cytaty nie podnoszą ocen.
- W trybie jakości poprawki są porównywane z poprzednią wersją bez ujawniania poprzednich ocen. Kolejność wersji jest losowana. Pogorszenie rymów, flow, języka, hooka lub stylu blokuje wybór, poza priorytetową naprawą kompletności/tempa.
- W trybie szybkim wykonywane są 3 wywołania; tryb jakości domyślnie do 7 (dwie rundy poprawek i porównań).
- Zakładka **Całość** pokazuje cały numer w jednym polu. **Kopiuj całość** kopiuje tytuł, koncept, Lyrics, Style i Exclude. Pola Lyrics i Style pozostają dostępne do osobnego wklejenia w Suno.
- Zadania działają w tle, pokazują postęp i można je odebrać po odświeżeniu tej samej karty. Zamknięcie karty nie anuluje już uruchomionych płatnych wywołań.

## Model i ustawienia

Domyślny model autora i recenzenta: `gpt-6-astra`, rozumowanie `high`. Nazwa i obsługa Responses API oraz Structured Outputs sprawdzone w oficjalnej dokumentacji: https://developers.openai.com/api/docs/models/gpt-6-astra . Dostępność zależy od konta API. Model wybiera się na serwerze, niezależnie od modelu rozmowy w ChatGPT.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| OPENAI_MODEL | gpt-6-astra | Model autora i producenta |
| OPENAI_REVIEW_MODEL | taki jak OPENAI_MODEL | Opcjonalny osobny model recenzenta |
| OPENAI_REASONING_EFFORT | high | low / medium / high / xhigh / max; model musi obsługiwać wybraną wartość |
| MAX_AI_CALLS | 7 | Limit 3–9, obejmuje próby; bez automatycznych ponowień po błędzie |
| OPENAI_MAX_OUTPUT_TOKENS | 16000 | Limit odpowiedzi z tokenami rozumowania, zakres 8000–64000 |
| OPENAI_TIMEOUT_MS | 240000 | Limit czasu pojedynczego wywołania, 30000–600000 ms |
| PORT | 3000 | Port serwera |

Można wybrać np. `gpt-6.1-sol`, `gpt-5.4` lub `gpt-4.1`, jeśli konto je obsługuje. Parametr reasoning jest wysyłany dla rodzin GPT-5/GPT-6 i o; temperature dla nich pomijamy. Dla gpt-4.1 pomijamy reasoning. Wybrany model musi obsługiwać Responses API i JSON Schema. Nie ma cichego przejścia na słabszy model po błędzie.

Koszt jest rozliczany przez OpenAI, osobno od abonamentu ChatGPT. Mocny model z rozumowaniem może zużyć więcej tokenów i czasu. Aplikacja pokazuje zużycie; opcjonalne stawki szacunku to `INPUT_USD_PER_M`, `OUTPUT_USD_PER_M`, a dla innego modelu recenzenta `REVIEW_INPUT_USD_PER_M`, `REVIEW_OUTPUT_USD_PER_M`. Nie wpisano na stałe cen, aby nie pokazywać nieaktualnych kosztów.

Próg redakcyjny: wszystkie kategorie co najmniej 8/10, bez zgłoszonych usterek. To subiektywna analiza AI. Weryfikacja cytatów sprawdza ich obecność w tekście, nie mierzy akustycznie jakości rymów. Flow, melodia i brzmienie wymagają odsłuchu w Suno. Próg nie gwarantuje hitu.

## Testy i utrzymanie

`npm test` uruchamia testy offline; HTTP wymaga możliwości otwarcia lokalnego portu. Testy symulują odpowiedzi API, nie pobierają klucza i nie naliczają opłat. Realna jakość utworu wymaga sprawdzenia z Twoim API i odsłuchu.

Historia (15 wyników) i zadania są w pamięci procesu. Wyniki zadań wygasają po dwóch godzinach lub restarcie serwera; pobierz TXT, aby je zachować. Hosting z wieloma replikami wymaga wspólnego magazynu zadań; ta paczka jest przeznaczona dla jednego procesu.

Plik `KARASKO-ALL-IN-ONE.cjs` zawiera identyczną aplikację razem z interfejsem w jednym pliku. Możesz uruchomić go przez `node KARASKO-ALL-IN-ONE.cjs`, bez package.json i pozostałych plików. Wersję wieloplikową uruchamia `npm start`.
