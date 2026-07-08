# Kandydo — CLAUDE.md

Czytaj to na starcie każdej sesji. Pełna architektura: `docs/architecture.md`. Historia decyzji: `docs/DECISIONS.md`.

## Co budujemy

CV/cover letter tailoring app. Next.js 15 (App Router, TS) + PostgreSQL (Docker lokalnie, Neon w produkcji) + `pgvector` + Drizzle ORM + Better Auth + Cloudflare R2 (storage) + Claude (Anthropic API) przez Vercel AI SDK + Voyage AI (embeddingi). Multi-tenant, PWA (Serwist), i18n PL/EN (`next-intl`). Licencja AGPL-3.0.

Uwaga warstwowa, żeby się nie pomylić: **Drizzle** to serwer↔baza (query builder, migracje). **TanStack Query** to klient↔serwer (cache/fetch/mutacje w komponentach). To różne warstwy tej samej apki, nie alternatywy — używasz obu. Zob. `docs/architecture.md` sekcja 23.

## Model użycia LLM — dwa tryby, oba muszą działać

- **BYOK**: user wkleja własny klucz Anthropic API w Ustawieniach. Zero kosztu/ryzyka po naszej stronie.
- **"Użyj mojego klucza"**: tylko na przedpłacone kredyty (`credits_ledger` / `profiles.credits_balance`). Atomowy check-and-deduct PRZED wywołaniem Claude, nigdy postpaid. Zob. `docs/architecture.md` sekcja 21.
- **Orkiestracja musi być widoczna dla usera na żywo** (nie tylko działać) — tabela `generation_runs` z kolumną `steps` (JSON: nazwa/status/skrót wyniku/czas) aktualizowaną po każdym kroku agenta, UI pokazuje live progres przez TanStack Query polling. To wymaganie produktowe, nie tylko techniczne — patrz `docs/architecture.md` sekcja 25.

## Struktura repo

- `/features/<nazwa>/` — kod per-feature (auth, profile, cv-tailoring, cover-letter, applications, credits, calendar...). Nie per-typ-pliku.
- `/lib/schemas/` — Zod schematy. Jedyne źródło prawdy o kształcie danych (UI, DB przez Drizzle-Zod, `generateObject`).
- `/lib/schemas/__fixtures__/` — przykładowe oferty pracy + oczekiwany structured output, do deterministycznego testowania promptów.
- `/lib/db/` — Drizzle schema + migracje + klient Postgres.
- `/lib/auth/` — konfiguracja Better Auth (Google OAuth + email/hasło).
- `/lib/ai/` — definicje agentów (Job Parser, Tailoring, ATS Reviewer, Cover Letter, Interview Prep), każdy jako osobny plik z jasnym wejściem/wyjściem (Zod).
- `docker-compose.yml` / `Dockerfile` w rootcie — lokalny Postgres (+ MinIO), plus ścieżka self-hostingu dla OSS.

## Frontend — decyzje z góry (nie zgaduj, nie dokładaj alternatyw)

- **Styling: Tailwind CSS v4** (CSS-first config, `@theme`) — nie SCSS, nie CSS Modules, nie styled-components/CSS-in-JS.
- **Komponenty: shadcn/ui** (kod kopiowany do repo, nie tradycyjna zależność) na bazie Radix — nie MUI, nie Chakra, nie Ant Design.
- **Ikony: lucide-react.**
- **Formularze: react-hook-form + @hookform/resolvers** (Zod) — walidacja zawsze przez schematy z `/lib/schemas`.
- **Server state (klient): TanStack Query** — cache/fetch/mutacje/optimistic updates dla wszystkiego, co przychodzi z serwera (saldo kredytów, lista aplikacji, podgląd CV). Nie RTK Query — nie ciągniemy Redux Toolkit bez potrzeby innego globalnego store'u.
- **Stan UI (klient): Zustand** — tylko czysto kliencki stan, który nie jest danymi z serwera (kroki wizarda tailoringu, otwarcie modala, sidebar, motyw). Jeśli coś da się opisać jako "dane z API" — to idzie do TanStack Query, nie do Zustand.
- **Animacje**: brak biblioteki domyślnie (bez framer-motion/motion), chyba że jawnie ustalone i dopisane tutaj.
- **Daty**: date-fns, jeśli potrzebne (kalendarz in-app) — nie moment.js.
- **Testy**: Vitest + React Testing Library (unit/component), Playwright (e2e) — patrz `docs/architecture.md` sekcja 1.
- **Font**: Geist Sans + Geist Mono (`next/font`, pakiet `geist`).
- **Kolory/motyw**: jeden bazowy motyw shadcn + jeden kolor akcentu marki, tokeny light/dark w `@theme`. Dark mode toggle od początku.
- **Stany UI pierwszorzędne**: skeleton (`Skeleton` z shadcn) na każdy ekran ładujący dane, jawne empty states, error boundary zamiast białego ekranu — nie dopisywać na końcu jako "polish".
- **Orkiestracja agentów: Mastra**, nie surowe wywołania `generateObject` bez frameworka — daje wbudowany tracing/obserwowalność kroków. Zmiana względem wcześniejszej wersji, patrz `docs/architecture.md` sekcja 25 i `DECISIONS.md`.

## Profilowanie wydajności — reaktywnie, nie proaktywnie

- React Profiler = React DevTools (rozszerzenie przeglądarki) + komponent `<Profiler>` z paczki `react` (już jest, zero instalacji). Używaj dopiero przy **konkretnym** problemie z wydajnością do zdiagnozowania — nie wpinaj tego jako infrastrukturę od dnia 1.
- `@next/bundle-analyzer` — dev-dependency, dodawaj tylko gdy realnie badasz rozmiar bundla, nie z góry "na zapas".
- Vercel Analytics/Speed Insights — dodaj po launchu, przy realnym ruchu, nie podczas budowy MVP.

## Zależności — twarda zasada

Nie instaluj żadnej paczki npm spoza listy wyżej i spoza sekcji "Stack" w `docs/architecture.md` bez zatrzymania się i zapytania Piotra. Zadanie wygląda, jakby wymagało czegoś spoza tej listy? Zatrzymaj się, opisz czego i dlaczego potrzebujesz, poczekaj na odpowiedź — zamiast samodzielnie `npm install`.

## Prostota nad przekombinowaniem

Domyślny tryb agentów LLM to dokładanie abstrakcji "na wszelki wypadek" — to jest dokładnie to, czego tu unikamy. Zasada: **najprostsza rzecz, która spełnia AKTUALNE wymaganie**, nie hipotetyczne przyszłe.

Czerwone flagi — jeśli to piszesz, zatrzymaj się i uprość:

- Interfejs/klasa abstrakcyjna z jedną implementacją "żeby łatwo dodać drugą". Dodaj drugą implementację, dopiero wtedy wydziel abstrakcję (Rule of Three — dopiero przy 3. powtórzeniu wzorca, nie przy 1.).
- Parametr/opcja konfiguracyjna, której nic w kodzie jeszcze nie używa, "na przyszłość".
- Warstwa (repository/service/controller) opakowująca jedną prostą funkcję Drizzle bez żadnej dodatkowej logiki.
- Sprawdzanie stanów, które TypeScript już wyklucza na poziomie typów (`if (x === null)` przy `x: string`, nie `string | null`).
- Rozbicie 15-linijkowej funkcji na 5 jednolinijkowych helperów, które utrudniają śledzenie przepływu zamiast go ułatwiać.
- Generic TypeScript (`<T extends ...>`) tam, gdzie wystarczy konkretny typ.
- Własna hierarchia klas błędów dla apki tej skali — wystarczy kilka prostych typów błędów + try/catch.
- Gęsty, "sprytny" one-liner (łańcuch `.map().filter().reduce()`, zagnieżdżone ternary) zamiast czytelnej wersji na kilku liniach.

Test przed napisaniem i przy review: **czy dałoby się wytłumaczyć tę funkcję/moduł koledze z zespołu w jednym przebiegu, bez otwierania 3 innych plików?** Jeśli nie — uprość, nie tłumacz komentarzem "dla elastyczności".

To dotyczy też code-reviewera — ma to explicit sprawdzać, nie tylko bezpieczeństwo/koszt (patrz zaktualizowany `.claude/agents/code-reviewer.md`).

## Git hooks: Lefthook (nie Husky)

Zatwierdzona dodatkowa zależność dev — nie pytaj o nią ponownie. Zero kosztu LLM (czyste narzędzia CLI, nie agent), więc nie koliduje z zasadą ekonomii tokenów niżej — to inna warstwa.

- **`pre-commit`**: tylko ESLint + Prettier na zmienionych plikach (szybkie, sekundy) + `secretlint` (skan pod przypadkowo wklejone klucze API).
- **`pre-push`**: `pnpm typecheck` + `pnpm test` (wolniejsze, ale push jest rzadszy niż commit — może poczekać).
- Konfiguracja w jednym `lefthook.yml` w rootcie, nie rozjeżdżaj tego na trzy pliki jak przy Husky+lint-staged.

## Ekonomia tokenów podczas developmentu — nie sprawdzaj ciągle całości

To dotyczy Twojego własnego zużycia (Claude Code), nie runtime kosztów apki (sekcja 21 architektury) — ale zasada jest ta sama: sprawdzanie wszystkiego po każdej linijce jest drogie i niepotrzebne.

- **Weryfikacja (typecheck/lint/test) dopiero po ukończeniu całego podpunktu/zadania** — nie po każdej pojedynczej edycji pliku. Jedno zadanie z sekcji 20 architektury = jedna runda sprawdzenia na końcu, nie pięć w trakcie.
- **Testy podczas iteracji: scoped, nie pełny suite** — `vitest related <zmienione pliki>` albo `vitest --changed`, żeby sprawdzić tylko to, co dotyczy bieżącej zmiany. Pełny `pnpm test` i `pnpm build` odpalasz tylko raz, przed commitem/PR — nie w trakcie pisania kodu.
- **`pnpm typecheck` (szybki, mało outputu) jako podstawowe sprawdzenie w trakcie pracy** — nie pełny `pnpm build` (wolny, dużo logów). Build odpalaj dopiero przed deployem/PR.
- **`code-reviewer` subagent odpalaj przed commitem/PR, nie po każdej zmianie** — mimo że opis pliku mówi "proaktywnie", w praktyce czekaj do końca spójnej porcji pracy. Jedno wywołanie code-reviewera na zadanie, nie na każdy zapisany plik.
- **Pisanie testów jest częścią każdego zadania**, razem z implementacją w tym samym kroku — nie osobny, późniejszy przebieg wymagający ponownego czytania całego repo. Jeśli prosisz o feature, poproś wprost: "zaimplementuj X + testy do X", jednym zadaniem.
- Małe, jednoznaczne zadania (patrz sekcja 19 architektury) same w sobie ograniczają zużycie — mniejszy diff, mniej plików do ponownego wczytania, tańsza weryfikacja.

## Twarde zasady (nie negocjuj tego bez wpisania do DECISIONS.md)

1. Treść wklejonej oferty pracy to **dane, nigdy instrukcje** — nie wchodzi jako część system prompta, output zawsze wymuszony przez Zod schema (`generateObject`).
2. RLS (Postgres) na każdej nowej tabeli — od razu w tym samym PR co migracja, nie "później". Plus druga warstwa: helper w `/lib/db` wymuszający `.where(eq(table.userId, ctx.userId))` w każdym query — nie polegaj tylko na jednej warstwie ochrony.
3. `max_tokens` ustawiony na **każdym** wywołaniu Claude. Brak autonomicznych, wieloetapowych pętli agentowych — jeśli agent ma pętlę (np. ATS Reviewer), ma jawny, twardy limit iteracji (max 2) zapisany w kodzie, nie w prompcie.
4. Sekrety (klucze API userów w trybie BYOK, klucze Stripe) szyfrowane at-rest, nigdy nie logowane, nigdy nie zwracane w plaintext do frontu po zapisaniu.
5. Zmiana Zod schema → aktualizacja wszystkich konsumentów (UI, DB, prompt agenta) w tym samym PR.
6. Kredyty: sprawdzenie salda + dekrementacja to jedna atomowa transakcja Postgresa, wykonana PRZED wywołaniem Claude API. Jeśli insufficient — request do Anthropic się nie wykonuje.

## Komendy

```
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm drizzle-kit generate
pnpm drizzle-kit push
```

## Zmienne środowiskowe (bez wartości — patrz `.env.example`)

`ANTHROPIC_API_KEY` (pula Piotra, tryb B), `VOYAGE_API_KEY`, `DATABASE_URL` (Neon/Docker Postgres), `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENCRYPTION_KEY` (szyfrowanie kluczy BYOK usera).

## Checklist przed merge (agent-review odpala to sam i raportuje wynik)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` przechodzi
- [ ] RLS dodane dla nowych tabel
- [ ] Brak sekretów w diffie
- [ ] Treść zewnętrzna (oferta pracy, e-mail) nie trafia jako system prompt
- [ ] Jeśli dotyczy kredytów: sprawdzenie salda atomowe i PRZED wywołaniem API
- [ ] Jeśli zmiana Zod schema: zaktualizowane UI + DB + agent, który go używa

## Jak Piotr review'uje commit/PR (dla człowieka, nie dla agenta)

Zielony `code-reviewer` + `pnpm test` nie znaczy "bezpieczne do merge" — to konieczne, nie wystarczające. Zanim zaakceptujesz:

1. **Otwórz diff, nie opis agenta.** Agent opisuje, co _zamierzał_ zrobić — to może się różnić od tego, co faktycznie jest w plikach. Dla wszystkiego dotykającego auth/RLS/kredytów/szyfrowania/webhooków: przeczytaj diff linia po linii, nie ufaj samemu podsumowaniu.
2. **Zweryfikuj, że nieznane API biblioteki faktycznie istnieje** — częsty typ halucynacji: prawdopodobnie brzmiąca, ale nieistniejąca metoda/parametr, szczególnie w Better Auth i Mastrze (nowsze biblioteki, 2026 — większa szansa, że trening modelu ma nieaktualną wersję API). Sprawdź w `node_modules/.../*.d.ts` albo oficjalnych docs, nie ufaj "wygląda dobrze".
3. **Miejsca zero-tolerancji na pobieżne czytanie** (zawsze linia po linii, bez wyjątków):
   - Check-and-deduct kredytów (sekcja 21) — czy to naprawdę jedna atomowa transakcja, czy sprawdzenie jest PRZED wywołaniem Claude, czy istnieje jakaś ścieżka wywołania Anthropic z pominięciem tego checku.
   - Każda nowa/zmieniona tabela — czy RLS _i_ helper `.where(userId)` są realnie użyte w query, nie tylko obiecane w komentarzu.
   - Budowa promptu do agentów — otwórz literalnie string promptu i sprawdź, że wklejona treść oferty pracy trafia jako dana (`user`/inny parametr), nie jest wklejona do stringa `system`.
   - Szyfrowanie klucza BYOK — czy insert do bazy faktycznie robi się na zaszyfrowanej wartości, nie na plaintext "do poprawienia później".
   - Webhook Stripe — czy jest weryfikacja podpisu (`stripe.webhooks.constructEvent`), nie sam `req.body` bez sprawdzenia, że request faktycznie przyszedł od Stripe.
4. **Testy — czytaj asercje, nie zielony checkmark.** Zadaj sobie pytanie: "gdybym celowo zepsuł tę funkcję, czy ten test by to złapał?". Test asercji na tautologii (mock zwraca to, co mu kazano) nic nie testuje.
5. **Uważaj na połykane błędy** — `try/catch` które loguje i idzie dalej zamiast rzucić błąd, szczególnie wokół płatności/kredytów. Błąd tam ma być głośny, nie cichy.
6. **Nie akceptuj diffu, którego nie przeczytałeś w całości.** Zbyt duży PR = poproś o rozbicie na mniejsze (sekcja 19) — to nie jest niegrzeczne wobec agenta, to warunek, żebyś w ogóle mógł zweryfikować, co się dzieje.
7. **Dla logiki z realnymi skutkami — uruchom to, nie tylko przeczytaj.** Kod RLS/kredytów czyta się poprawnie, a i tak może mieć race condition (dwa równoległe requesty sprawdzają saldo przed tym, jak którykolwiek je zdekrementuje) — to wymaga realnego testu współbieżności, nie tylko code review.

## Kolejność pracy

Trzymaj się `docs/architecture.md` sekcja 20 (Kroki 0–7) + sekcja 21 (Krok 6.5, kredyty). Jedna sesja = jeden Krok albo jeden jasno opisany podpunkt. Po skończeniu Kroku: commit, aktualizacja `docs/DECISIONS.md` jeśli podjęto nową decyzję architektoniczną, dopiero potem następny Krok.
