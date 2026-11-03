# KARASKO HIT CONTROL 2.0

Nowa, kompletna wersja Node.js. Automatyczny dobór BPM i Style, pełne Lyrics, jedno pole do kopiowania, recenzja i poprawki. Opcjonalne wyszukiwanie aktualnych publicznych źródeł YouTube/YouTube Music/TikTok przez Brave Search API i YouTube Data API. Bez kluczy wyszukiwarki program **nie** przeszukuje internetu i uczciwie o tym informuje.

## Wgranie na GitHub i Render (telefon)
1. Otwórz repozytorium `karasko1985-cmd/karasko-hit-control.` na GitHubie.
2. Podmień pliki `server.js`, `app.js`, `index.html`, `style.css`, `package.json`, `render.yaml` na zawartość z tej paczki (zachowaj nazwy). Nie twórz zagnieżdżonego katalogu — pliki muszą być w głównym katalogu repozytorium. Alternatywnie utwórz nowe repozytorium i prześlij tam wszystkie pliki, a następnie połącz nowe repozytorium z Render.
3. Render → usługa → Environment: `OPENAI_API_KEY` = prywatny klucz OpenAI (NIGDY nie w repozytorium); `OPENAI_MODEL` = model zgodny z endpointem Chat Completions i `json_object` (domyślnie `gpt-4.1`); opcjonalnie `APP_PASSWORD`.
4. Opcjonalnie: `BRAVE_SEARCH_API_KEY` dla wyników wyszukiwarki i/lub `YOUTUBE_API_KEY` dla wyszukiwania YouTube. TikTok nie ma w tej wersji bezpośredniej integracji z jego prywatnym feedem — można znaleźć publiczne strony TikToka w wyszukiwarce.
5. Render: Save, deploy → poczekaj na Live → otwórz adres usługi.

## Budżet
Docelowo maksymalnie 1 USD na utwór. Aplikacja szacuje zużycie tokenów i blokuje kolejne wywołania, gdy prognoza przekroczy 90% budżetu. **Nie jest to twardy limit billingowy**, bo rzeczywista cena modelu, tokenizacja i rozliczenie zależą od OpenAI. Domyślne stawki w aplikacji są celowo ostrożne: $4/$16 za milion tokenów input/output. Ustaw `INPUT_USD_PER_M` i `OUTPUT_USD_PER_M` zgodnie z aktualnym cennikiem wybranego modelu. Dla twardego limitu finansowego ustaw osobny limit budżetowy projektu w OpenAI Platform i monitoruj użycie.

## Bezpieczeństwo
Nie zapisuj sekretów w GitHubie. Zdecydowanie ustaw `APP_PASSWORD`, ponieważ publiczna aplikacja bez hasła pozwala innym uruchamiać płatne generacje. Wyniki i oceny AI nie gwarantują hitu. Wyszukiwanie dostarcza metadane i opisy, nie analizuje faktycznego audio ani cudzych pełnych tekstów.

## Ograniczenia
- Nie ma jeszcze sterowania z czatu ChatGPT: wymaga osobnej autoryzowanej integracji.
- Nie ma bezpośredniego wysyłania do Suno.
- Każde uruchomienie może generować opłaty OpenAI API.

## Wynik audytu (2026-11-03)
- Poprawiono przedwczesne zatrzymanie redakcji po jednej poprawce; dostępne są teraz maksymalnie 3 recenzje i 2 poprawki, zależnie od kosztu.
- Zweryfikowano składnię JS i odpowiedź HTTP /api/status bez klucza.
- Nie testowano płatnych odpowiedzi modelu ani zewnętrznych wyszukiwarek; to wymaga kluczy i może kosztować.
- Budżet 1 USD to szacunkowy bezpiecznik, **nie twardy limit**. Stawki $4/$16 za milion tokenów są przykładowe i muszą odpowiadać wybranemu modelowi.
- Wymagane przed publicznym wdrożeniem: APP_PASSWORD, aby obce osoby nie mogły generować na Twój koszt.
