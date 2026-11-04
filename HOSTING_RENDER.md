# Wdrożenie i aktualizacja Render

## Aktualizacja istniejącej aplikacji

1. Podmień pliki repozytorium zawartością paczki, w tym nowe `ai.js` i `quality.js`. Nie dodawaj `.env`.
2. Zachowaj istniejące `OPENAI_API_KEY` i `APP_PASSWORD` w Render → Environment.
3. Ustaw **OPENAI_MODEL=gpt-6-astra**, **OPENAI_REASONING_EFFORT=high** i **OPENAI_TIMEOUT_MS=600000** (domyślny limit jednego wywołania). Usuń stare OPENAI_REVIEW_MODEL albo ustaw ten sam model. Jeśli pozostawisz wcześniejsze OPENAI_MODEL, Render nadal będzie go używać. Brak dostępu do modelu zostanie pokazany jako błąd; możesz wybrać inny dostępny model.
4. Ustaw Build Command `npm install`, Start Command `npm start`, Node.js 20 lub nowszy. Uruchom wdrożenie.
5. Po wejściu na stronę sprawdź nazwę modelu w górnym pasku. Wpisz temat i preferencje, wybierz Jakość. Wynik skopiujesz przyciskiem **Kopiuj całość**.

Jeśli używasz pojedynczego pliku `KARASKO-ALL-IN-ONE.cjs`, ustaw Build Command `true` oraz Start Command `node KARASKO-ALL-IN-ONE.cjs`. Nie potrzebuje instalacji zależności.

## Nowa aplikacja

Utwórz prywatne repozytorium, dodaj pliki paczki bez .env. Render → New → Blueprint → wybierz repozytorium. Blueprint poprosi o OPENAI_API_KEY i APP_PASSWORD. W logowaniu aplikacji użyj dowolnej nazwy użytkownika i ustawionego APP_PASSWORD.

Generowanie działa jako zadanie z odpytywaniem postępu, więc przeglądarka nie utrzymuje jednego wielominutowego żądania. Nie duplikuj generacji podczas oczekiwania. Restart/deploy lub uśpienie procesu usuwa zadania i historię; pobieraj wyniki jako TXT. Używaj jednej instancji serwera. Dostępność, uśpienie i ceny planów hostingu sprawdź w panelu Render.
