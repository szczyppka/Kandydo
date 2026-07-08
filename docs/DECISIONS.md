# Decyzje projektowe (dziennik) — Kandydo

Krótki log "co i dlaczego", żeby świeża sesja agenta nie musiała odkrywać kontekstu od nowa. Dopisuj nową decyzję, gdy coś architektonicznego się zmienia — nie edytuj historii, dopisuj datę.

- **Stack**: Next.js 15 (App Router, TS) + Supabase (Postgres/pgvector/Auth/Storage) + Drizzle ORM + Claude (Anthropic API) przez Vercel AI SDK + Voyage AI (embeddingi). Jeden codebase TS, auth+DB+RLS+storage z jednego miejsca, Claude dobry do spójnego, długiego tekstu i trzymania struktury.

- **BYOK jako rdzeń, nie dodatek**: użytkownicy Claude.ai Pro/Max NIE mogą podpiąć swojej subskrypcji do apki — Anthropic zakazał używania OAuth z planów Free/Pro/Max w narzędziach zewnętrznych (polityka od IV 2026, naruszenie Consumer ToS). Trzeba użyć osobnego klucza API z console.anthropic.com (pay-as-you-go, inne rozliczenie niż Claude.ai).

- **Model hybrydowy od dnia 1**: (A) BYOK — darmowy, zero ryzyka po naszej stronie; (B) "użyj mojego klucza" — tylko na przedpłacone kredyty, nigdy postpaid. Powód: Piotr chce oferować dostęp bez własnego klucza API, ale bez ryzyka finansowego DoS/prompt injection.

- **Licencja: AGPL-3.0**, nie MIT. Powód: chroni przed tym, że ktoś sforkuje i zhostuje konkurencyjny SaaS bez oddania zmian; otwiera drogę do własnego, opcjonalnego "open core" Cloud planu w przyszłości bez sprzeczności licencyjnej.

- **Nazwa: Kandydo**. Sprawdzona pod kątem kolizji w niszy CV/kariera (czysto) i konotacji w innych językach europejskich (czysto; w esperanto "kandido" = kandydat, ta sama łacińska podstawa). Zapasowe: Rolendo, Dopasa. Domena/znak towarowy — zweryfikować ręcznie przed finalizacją brandingu (research robiony przez wyszukiwarkę, nie przez WHOIS/EUIPO).

- **PWA: Serwist**, nie next-pwa (nieaktualizowany od lat, Serwist rekomendowany wprost w docs Next.js). Offline = podgląd wcześniej wygenerowanych CV/profilu/aplikacji (IndexedDB cache) i edycja z sync po powrocie sieci. Generowanie nowego CV zawsze wymaga sieci (wywołanie Claude) — offline tego nie obejdzie.

- **Kalendarz: in-app + eksport `.ics`**, nie integracja z Google Calendar API na start. Pole `applications.interview_at`/`interview_notes` jako źródło danych. Google Calendar to scope "sensitive" (tania weryfikacja) — świadomie odłożone post-MVP, nie z powodu kosztu, tylko priorytetu.

- **Gmail / odczyt odpowiedzi z maila: odłożone całkowicie na start**. Gmail API to scope "restricted" — wymaga corocznego audytu CASA Tier 2 (~$540–1000 przez self-serve lab + własna weryfikacja Google, łącznie 4–12+ tygodni, coroczna recertyfikacja). Gdy wrócimy do tematu: przez unikalny alias e-mail per user + Mailgun/Postmark inbound parsing — NIE przez Gmail API. Zupełnie inna, dużo tańsza ścieżka.

- **Płatności: przedpłacone kredyty, nie subskrypcja**. Powód: Przelewy24 (BLIK) przez Stripe obsługuje tylko płatności jednorazowe, nie recurring — więc subskrypcja i tak wymagałaby ograniczenia się do karty. Kredyty kupowane jednorazowo (Stripe Checkout, one-time mode) obsługują natywnie i P24/BLIK, i kartę w tym samym flow.

- **Bezpieczeństwo finansowe trybu "mój klucz"**: atomowa transakcja check-and-deduct kredytów PRZED wywołaniem Claude API (nie post-hoc rozliczenie), `max_tokens` na każdym wywołaniu, limit długości inputu (np. 6000 znaków na wklejaną ofertę), rate limiting per user, idempotency key per akcja generowania, log użycia (`usage_log`) do wykrywania anomalii, dzienny hard cap generacji niezależny od salda kredytów. Prompt injection i ryzyko finansowe to dwa osobne problemy z osobnymi zabezpieczeniami — injection nie może ominąć `max_tokens`.

- **RAG (pgvector + Voyage embeddings): odłożone do fazy skalowania**. Na start baza doświadczeń jednego użytkownika mieści się w kontekście taniej i prościej niż similarity search. Dodać, gdy: dużo userów LUB duże bazy doświadczeń per user zaczną boleć kosztowo/jakościowo.

- **Agenci AI**: Job Parser (Haiku, ekstrakcja structured), Tailoring/Cover Letter (Sonnet, pisanie treści), ATS Reviewer (Haiku, max 2 iteracje pętli), Interview Prep (Sonnet, tylko po "Zaaplikowałem"). Podział modeli celowo — Haiku 5–25x tańszy, wystarcza do klasyfikacji/ekstrakcji.

- **Recenzje**: tylko social-proof testimoniale na landing page (moderowane ręcznie przed publikacją). Odrzucona opcja "opinie o firmach jak Glassdoor" — ryzyko prawne/moderacyjne nieproporcjonalne do wartości na tym etapie.

- **Postgres (Docker + Neon) zamiast Supabase-BaaS, Better Auth zamiast Supabase Auth, Cloudflare R2 zamiast Supabase Storage**. Powód: projekt ma też pokazywać, że Piotr "dowozi wszystko" — zejście z warstwy BaaS na gołego Postgresa + własny auth pokazuje więcej konkretnych kompetencji niż korzystanie z gotowego pakietu. Dodatkowy plus: `docker-compose.yml` daje ścieżkę self-hostingu spójną z licencją AGPL. RLS realizowany dwuwarstwowo: natywne polityki Postgresa (session variable per-request) + helper w kodzie wymuszający filtrowanie po `user_id` w każdym query.

- **TanStack Query (nie RTK Query) + Zustand, obok Drizzle, nie zamiast**. Drizzle = warstwa serwer↔baza. TanStack Query = warstwa klient↔serwer (cache/mutacje w React). Zustand = wyłącznie czysto kliencki stan UI, rozdzielony od server state. RTK Query odrzucony — wymagałby całego Redux Toolkit bez potrzeby innego globalnego store'u.

- **Mastra: zmiana decyzji, przyjęte od początku, nie odłożone.** Wcześniej odrzucone jako niepotrzebne (przepływ agentów nie jest grafowy). Powód zmiany: cel projektu to też pokazać kompetencję w "orkiestracji agentów" — Mastra daje wbudowany tracing/obserwowalność kroków, czyli dokładnie to, czego brakuje surowym wywołaniom `generateObject`, żeby orkiestrację dało się komuś pokazać, nie tylko żeby działała.

- **Orkiestracja musi być widoczna na żywo w UI, nie schowana za jednym spinnerem.** Tabela `generation_runs` (JSON `steps`: nazwa/status/skrót wyniku/czas) aktualizowana po każdym kroku agenta, UI pokazuje live progres (TanStack Query polling, nie websockety — wystarczy przy generacji trwającej kilkanaście sekund). Ta sama tabela rozszerza `usage_log` z sekcji 21 architektury — jeden mechanizm, dwa zastosowania (bezpieczeństwo finansowe + demonstrowalność).

- **Design system**: Geist Sans/Mono, jeden bazowy motyw shadcn + jeden kolor akcentu marki, dark mode od początku, skeleton/empty state/error boundary jako pierwszorzędne stany UI (nie dopisywane na końcu). Animacje: darmowe utility Tailwinda, biblioteka tylko jeśli wizualizacja pipeline'u tego jawnie wymaga.

- **Vitest przypięty na `^3.x`, nie najnowszy `^4.x`**: `vitest@4.1.10` ciągnie rolldown-vite z natywnym bindingiem (`@rolldown/binding-darwin-arm64`), którego `pnpm` nie potrafi poprawnie zresolvować (potwierdzone dwoma czystymi reinstallami `node_modules`) — `pnpm test` padał na starcie.

- **Lokalny Docker Postgres: dedykowana rola `kandydo_app` (nie `kandydo`/`POSTGRES_USER`) do połączeń aplikacji.** Bootstrap `POSTGRES_USER` oficjalnego obrazu Postgresa jest zawsze superuserem z `BYPASSRLS` — Postgres bezwarunkowo pomija RLS dla superuserów, niezależnie od `FORCE ROW LEVEL SECURITY` (potwierdzone realnym testem: dwie polityki + FORCE ustawione poprawnie, a Alice mimo to widziała profil Boba, dopóki nie połączono się jako non-superuser `kandydo_app`). `docker/postgres-init/01-app-role.sql` tworzy tę rolę i czyni ją właścicielem bazy (nie tylko schematu `public` — drizzle-kit potrzebuje móc tworzyć własny schemat `drizzle` do trackingu migracji). To też wierniej odwzorowuje Neon w produkcji, gdzie dostarczona rola nie jest superuserem.

  **Ważne uzupełnienie**: FORCE chroni nie tylko przed superuserem, ale też przed **właścicielem tabeli** — a `kandydo_app` jest właścicielem wszystkich tabel aplikacji, więc bez FORCE RLS byłoby pomijane przez samo połączenie appki, nie tylko przez rolę admina. Drizzle nie ma buildera dla `FORCE ROW LEVEL SECURITY` (tylko `.enableRLS()`), więc jest dopisywane ręcznie do wygenerowanej migracji SQL — `drizzle-kit generate` o tym nie wie i nie chroni przed pominięciem przy przyszłej tabeli. Zabezpieczone automatycznym testem regresyjnym (`src/lib/db/rls-force.test.ts` — sprawdza `pg_class.relforcerowsecurity` dla każdej tabeli z włączonym RLS), zweryfikowanym na żywo (test faktycznie failuje po ręcznym `NO FORCE ROW LEVEL SECURITY`).

- **Struktura repo: `src/` od Kroku 1**, nie root-level `app/`/`lib/` jak wyszło ze scaffoldu Kroku 0. Jedyne jednoznaczne miejsce w dokumentacji (drzewo katalogów w architecture.md sekcja 22) pokazuje `src/app/`, `src/features/`, `src/lib/` — scaffold z `--no-src-dir` był przeoczeniem (ta sekcja nie była jeszcze doczytana), poprawione zanim `features/` urosło i migracja zrobiła się droższa.

- **`pnpm dev`/`pnpm build` bez `--turbopack`, wracamy na webpack.** `@serwist/next` (PWA) w stabilnym trybie (`withSerwistInit`, plugin webpack `InjectManifest`) explicite nie wspiera Turbopacka — tylko ostrzega i się wyłącza. Alternatywy (`@serwist/turbopack` — eksperymentalne, osobna paczka spoza zatwierdzonej listy; "configurator mode" Serwist — inny, bardziej złożony wzorzec integracji z CLI/esbuild) odrzucone na rzecz najstabilniejszej, najlepiej udokumentowanej ścieżki. `--turbopack` w Kroku 0 był domyślnym wyborem `create-next-app`, nie świadomą decyzją architektoniczną — nic nie łamiemy, cofając go.

- **PWA ikony to programowo wygenerowany placeholder** (`public/icons/`, blokowe "K" na zinc-900, wygenerowane skryptem Python bez żadnej nowej zależności — patrz git history Kroku 1), świadomie tymczasowe do podmiany na realne logo marki przed launchem.
