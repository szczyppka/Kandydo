# CV Tailoring App — plan techniczny

Multi-tenant appka (Ty + inni zarejestrowani użytkownicy), TS end-to-end, Claude jako silnik AI, RAG do doboru trafnych fragmentów doświadczenia pod konkretną ofertę.

> **Status na dziś (najnowsza wersja decyzji, patrz sekcja 17–21):** model hybrydowy **od dnia 1** — (A) BYOK: user wkleja własny klucz Anthropic, płaci sam, zero kosztu/ryzyka po Twojej stronie; (B) "użyj mojego klucza": tylko na **przedpłacone kredyty** (one-time, BLIK/karta), z twardymi limitami technicznymi, żeby nikt Cię nie zbankrutował przez prompt injection ani spam requestów — pełny mechanizm w sekcji 21. Google Calendar i Gmail (sekcja 14) nadal odłożone — w zamian: prosty kalendarz in-app + eksport `.ics`, patrz sekcja 18.

## 1. Stack

| Warstwa | Wybór | Dlaczego |
|---|---|---|
| Full-stack framework | **Next.js 15 (App Router)** | Jeden codebase TS na front (React) i backend (route handlers/server actions), Vercel deploy "z pudełka" |
| DB | **PostgreSQL** (Docker lokalnie, **Neon** w produkcji) + `pgvector` | Prawdziwa, przenośna baza, nie zamknięty BaaS — patrz sekcja 23 (zmiana ze Supabase) |
| Auth | **Better Auth** | Standard 2026 dla stacku Next.js+Drizzle+Postgres — self-hosted (zero zewnętrznej zależności), natywny Google OAuth, wbudowany rate limiting (przydaje się w sekcji 21) |
| Storage | **Cloudflare R2** (S3-compatible) | Przechowywanie wygenerowanych PDF-ów, tanie/bez opłat za egress |
| ORM | **Drizzle** | Type-safe query builder + migracje, warstwa serwer↔baza. Nie konkuruje z TanStack Query (patrz sekcja 23) — to inna warstwa |
| Server state (klient) | **TanStack Query** | Cache/fetch/mutacje danych z serwera w komponentach React (nie RTK Query — nie ciągniesz całego Redux Toolkit bez potrzeby) |
| Stan UI (klient) | **Zustand** | Tylko czysto kliencki stan (kroki wizarda, modale, sidebar) — rozdzielone od server state z TanStack Query |
| Konteneryzacja | **Docker** (docker-compose lokalnie: Postgres + MinIO) | Lokalne środowisko 1:1 z produkcją, plus działa jako gotowa ścieżka self-hostingu dla OSS (sekcja 17) |
| LLM | **Anthropic Claude API** (`@ai-sdk/anthropic`) | Twój wybór; dobre do spójnego, długiego tekstu i trzymania się struktury/instrukcji |
| Warstwa LLM w kodzie | **Vercel AI SDK** (`ai`, v6) | Ujednolicony `generateObject`/`streamObject` z Zod schema, streaming do UI, tool calling. Od 2026 ma też **Workflows** — durable, długo działające multi-step agenty bez osobnego job runnera |
| Embeddings (tylko do RAG) | **Voyage AI** (`voyage-3.5`) | Anthropic nie ma własnych embeddingów i oficjalnie rekomenduje Voyage jako partnera — Claude generuje, Voyage embeduje |
| Orkiestracja multi-step | **Mastra** (od początku, nie odłożone) | TS-native framework agentowy z wbudowanym tracingiem/obserwowalnością kroków. Zmiana decyzji względem wcześniejszej wersji — patrz sekcja 25: portfolio wymaga, żeby orkiestracja była **widoczna**, nie tylko działająca |
| PDF | **@react-pdf/renderer** | Generuje realny tekst (nie obrazek), prosty layout jedno-kolumnowy = ATS-friendly. Unikaj Puppeteer/HTML→PDF z CSS grid/table — ATS-parsery się na tym wykładają |
| Testy | Vitest + Playwright | Standard w ekosystemie Next/TS |
| CI/CD | GitHub Actions → Vercel | Push na main = deploy |

Jedna aplikacja Next.js, bez oddzielnego backendu Express/Fastify — niepotrzebna komplikacja przy tej skali.

## 2. Model danych (Drizzle/Postgres)

```
users            -- zarządzane przez Better Auth
profiles         -- user_id, imię, nazwisko, kontakt, linki (www/github/linkedin), edukacja, ai_summary
experiences      -- user_id, firma, rola, daty, raw_description, ai_bullets[], tags/skills[], embedding vector(1024)
job_offers       -- user_id, raw_text/url, firma_parsed, rola_parsed, keywords[], requirements_summary (JSON)
cv_versions      -- user_id, job_offer_id, content JSON (structured CV), status: draft/approved, pdf_url
applications     -- user_id, job_offer_id, cv_version_id, status, applied_at, interview_prep JSON, notes
```

> **Aktualizacja (sekcja 23)**: baza to teraz zwykły Postgres (Docker/Neon), nie Supabase — RLS realizowany przez session variable ustawianą per-request wewnątrz transakcji (`SET LOCAL app.current_user_id = $1`), polityka `USING (user_id = current_setting('app.current_user_id')::uuid)`, plus druga warstwa: helper w `/lib/db` wymuszający `.where(eq(table.userId, ctx.userId))` w każdym query. Nie polegaj tylko na jednej z tych dwóch warstw.

RLS na każdej tabeli to Twój najważniejszy zamek bezpieczeństwa przy multi-tenant — bez tego użytkownik A zobaczy dane użytkownika B.

## 3. Dlaczego RAG, a nie tylko "wrzuć wszystko w prompt"

Przy niewielkiej liczbie wpisów (kilkanaście projektów) całe doświadczenie mieści się bez problemu w kontekście Claude'a — RAG nie byłby konieczny. Ale przy wielu użytkownikach i rosnącej bazie projektów (dziesiątki wpisów u aktywnego użytkownika) chcesz:

1. **Kontrolować koszt/tokeny** (Twój punkt 8) — nie płacić i nie czekać na przetworzenie całej historii zawodowej przy każdej ofercie.
2. **Trafność** — dać AI tylko fragmenty faktycznie związane z daną ofertą, żeby CV nie rozmywało się nieistotnymi projektami.

Dlatego: `experiences.embedding` (Voyage) + `job_offers` po sparsowaniu też dostaje embedding zapytania → pgvector similarity search zwraca top-N najbardziej pasujących wpisów → dopiero one trafiają w kontekst do agenta piszącego CV. To jest właściwy RAG, nie tylko marketing słowo.

## 4. Agenci AI wewnątrz aplikacji (Twoje punkty 1–9)

Każdy "agent" to w praktyce jedno lub dwa wywołanie `generateObject` z Zod schema. **Aktualizacja (sekcja 25)**: mimo to, budujesz je w Mastrze od początku (nie surowym AI SDK) — nie dlatego, że przepływ tego wymaga technicznie, tylko dlatego, że masz mieć widoczny tracing/obserwowalność kroków, żeby orkiestrację dało się komuś pokazać, nie tylko żeby działała.

1. **Profile Builder** (nie-AI + AI): CRUD na `experiences`; przy zapisie AI generuje `ai_bullets` i `embedding` w tle (Punkt 1, 3).
2. **Job Parser Agent**: wejście = wklejona treść oferty (albo URL do sfetchowania). Wyjście (Zod schema): firma, rola, seniority, must-have keywords, nice-to-have, ton języka. **Traktuj tę treść jako dane, nie instrukcje** — patrz sekcja 6, prompt injection (Punkt 4–5).
3. **Retrieval**: embed opisu oferty (Voyage) → pgvector top-N z `experiences` danego użytkownika.
4. **CV Tailoring Agent**: input = profil + top-N doświadczeń + wynik Job Parsera. System prompt z twardą zasadą: *tylko przeformułowuj i dobieraj słowa kluczowe z faktów podanych przez użytkownika, nigdy nie wymyślaj nowych faktów/liczb/technologii*. Output: structured CV JSON (Punkt 6).
5. **ATS Reviewer Agent**: sprawdza tailored CV względem keywords z Job Parsera, zwraca score + listę braków. Może zapętlić się raz do Tailoring Agenta (max 2 iteracje — kontrola kosztu), reszta idzie do usera jako sugestie (Punkt 2, 8).
6. **Preview/Edit UI**: user widzi structured JSON jako czytelny podgląd (nie renderuje PDF na tym etapie — oszczędność), edytuje, akceptuje (Punkt 8, 3).
7. **PDF Export** (deterministyczny kod, nie LLM): `@react-pdf/renderer` z zaakceptowanej treści (Punkt 7).
8. **Interview Prep Agent**: odpala się przy kliknięciu "Zaaplikowałem" — na podstawie różnicy między CV a ofertą generuje prawdopodobne pytania i punkty do przygotowania, zapisuje razem z aplikacją w `applications` (Punkt 9).

## 5. Podział pracy na agentów deweloperskich

Zgodnie z Twoim pomysłem — orchestrator + agenci per-obszar + code review. Praktyczne wdrożenie z Claude Code / Cowork:

- **PM/Orchestrator agent** — utrzymuje `CLAUDE.md` z konwencjami (schema, Zod kontrakty między warstwami), listę zadań/epików, sekwencjonuje pracę, robi merge. To Ty go najczęściej "uruchamiasz" ręcznie na start.
- **Backend/Data agent** — schema Drizzle, RLS policies, Better Auth, route handlers.
- **AI-pipeline agent** — prompty, Zod schematy dla `generateObject`, retrieval/embedding pipeline, logika Tailoring/ATS/Interview Prep agentów (Mastra — sekcja 25).
- **Frontend agent** — profile builder, formularz oferty, ekran podglądu/edycji, dashboard aplikacji (tracker).
- **DevOps agent** — CI/CD, sekrety, wiring Vercel+Neon+Cloudflare R2, monitoring kosztów LLM, `docker-compose` dev.
- **Code Review agent** — na każdy PR sprawdza: RLS na nowych tabelach, brak sekretów w kodzie, czy treść oferty pracy jest sanitized przed wysłaniem do LLM (injection), czy nie ma nielimitowanych wywołań LLM.

Technicznie: osobne branch/worktree per obszar, wspólny `CLAUDE.md` + zdefiniowane typy Zod jako "kontrakt" między backendem a AI-pipeline, żeby agenci nie blokowali się nawzajem. Review agent uruchamiany na każdym PR przed merge do main.

## 6. Rzeczy, które łatwo przeoczyć, a zepsują appkę po deployu

- **Prompt injection przez treść oferty pracy**: to nieufny, wklejony przez usera tekst. Nigdy nie wrzucaj go jako część system prompt ani nie pozwól, by "instrukcje" w ofercie (np. ukryty tekst "ignore previous instructions") wpływały na inne części pipeline'u. Parsuj go wyłącznie jako dane wejściowe do ustrukturyzowanej ekstrakcji z wymuszonym Zod schema.
- **Prawdziwość CV**: system prompt Tailoring Agenta musi jawnie zabraniać dodawania faktów spoza `experiences`. Warto dorzucić prosty "diff check" — czy wygenerowane zdania da się zmapować na źródłowe bullet pointy.
- **RLS od dnia pierwszego**, nie "dorobimy później" — przy multi-tenant to jest fundament, nie feature.
- **Limity kosztów**: cap tokenów per request (dzięki RAG), rate limit LLM calls per user/dzień — inaczej jeden użytkownik może wygenerować duży rachunek.
- **ATS-safe PDF**: jedna kolumna, standardowe fonty, brak ikon jako nagłówków sekcji, brak tabel do layoutu.

## 7. Kolejność wdrożenia

> **Nieaktualne w szczegółach — patrz sekcja 20** (finalny, skonsolidowany plan po zmianach ze Supabase na Postgres/Better Auth, BYOK, PWA). Ogólna kolejność faz poniżej wciąż aktualna, konkretne kroki już nie.

1. **Fundament**: repo, DB+Auth+RLS szkielet, Next.js na Vercel — "hello world" pipeline działający end-to-end pierwszego dnia.
2. **MVP core loop**: profil/doświadczenia CRUD, wklejenie oferty, Tailoring Agent v1 bez RAG (cały profil w kontekście — wystarczy przy małej bazie), podgląd, PDF.
3. **Tracker aplikacji**: zapis po "Zaaplikowałem", Interview Prep Agent.
4. **RAG + ATS Reviewer**: pgvector, self-critique loop, dociążenie przy większej bazie doświadczeń.
5. **Utwardzanie**: rate limity, audyt RLS, testy na prompt injection, monitoring kosztów.

Nie buduj RAG w kroku 2 — na małej bazie doświadczeń (Twojej własnej, na start) cały profil i tak zmieści się w kontekście taniej i prościej niż similarity search. Dodaj RAG jak realnie zacznie boleć (dużo wpisów / dużo userów).

---

## 8. Nazwa

Rynek jest zaskakująco zatłoczony — sprawdziłem żywe konkurencyjne produkty o zbliżonych nazwach (Tailorly, CVCraft, Resumatch, Fitly, JobFit.cv, JobCraft, CareerCraft Studio, Aplyr.ai, Resume Optimizer Pro i inne) i większość oczywistych, opisowych kombinacji ("CV" + "Tailor/Craft/Match/Fit") jest już zajęta przez konkretne apki w tej samej niszy. Stąd rekomendacja idzie w stronę wymyślonego słowa zamiast opisowego złożenia — łatwiej o wolną domenę i mniejsze ryzyko kolizji z marką.

**Rekomendacja: Kandydo**
Od polskiego "kandydat" — czytelne i chwytliwe dla polskiego użytkownika od razu, a po angielsku brzmi jak "candy-do"/"can-do" (pozytywne skojarzenie, łatwe do wymówienia). Krótkie, nie znalazłem żadnego istniejącego produktu ani apki o tej nazwie w przestrzeni CV/kariera/rekrutacja.

Zapasowe opcje (też czyste w wyszukiwaniu, na wypadek gdyby domena Kandydo była zajęta): **Rolendo**, **Dopasa** (od "dopasowanie").

**Zastrzeżenie**: robiłem to przez wyszukiwarkę internetową, nie mam dostępu do rejestrów WHOIS/EUIPO/USPTO z tej piaskownicy, więc to nie jest formalna gwarancja wolnej domeny czy braku zastrzeżonego znaku towarowego. Zanim zainwestujesz czas w branding, sprawdź ręcznie: dostępność domeny (np. Namecheap/OVH), zajętość na EUIPO (znaki towarowe UE) i czy handle jest wolny na GitHub/socialach.

## 9. Rozszerzenie zakresu: PL/EN + cover letter

Dwie zmiany w stosunku do planu z sekcji 1–7:

- **Dwujęzyczność** — rozdziel dwie różne rzeczy: język interfejsu (i18n UI, np. `next-intl` z katalogami `en.json`/`pl.json`) i język generowanej treści (CV/cover letter mogą być po polsku, nawet gdy UI jest po angielsku, i odwrotnie — polski kandydat aplikujący do firmy zagranicznej chce CV po angielsku). Dodaj pole `language` do `job_offers` (Job Parser Agent wykrywa język oferty automatycznie) i do `cv_versions`/`cover_letters` (domyślnie = język oferty, user może nadpisać). Claude generuje natywnie dobrze w obu językach — nie potrzeba osobnego serwisu tłumaczeń.
- **Cover Letter Agent** — nowy agent obok Tailoring Agenta, korzysta z tego samego Job Parsera i tego samego retrievalu (top-N doświadczeń), inny Zod schema wyjścia (powitanie, hook nawiązujący do firmy/roli, 2–3 akapity łączące doświadczenie z wymaganiami, zakończenie z call-to-action). Ta sama zasada prawdziwości (tylko fakty z profilu), ten sam ekran podglądu/edycji przed eksportem, ten sam eksport PDF (osobny prosty template).

Zmiana w modelu danych: albo osobna tabela `cover_letters` (job_offer_id, content JSON, status, pdf_url, language) — prościej niż dogadywanie typu w `cv_versions`, i tak strukturalnie to inny dokument.

## 10. Plan krok po kroku

> **Zastąpione przez sekcję 20** (Supabase w krokach poniżej → Postgres/Neon/Docker/Better Auth po zmianie z sekcji 23). Zostawione dla historii rozumowania, nie jako źródło prawdy — pracuj z sekcji 20.

**Krok 0 — przygotowanie (1 dzień)**
1. Zdecyduj nazwę ostatecznie, zarejestruj domenę + repo GitHub (prywatne na start).
2. Załóż projekt Supabase (Postgres + Auth + Storage), włącz `pgvector`.
3. `npx create-next-app` (TS, App Router) + Drizzle + podłączenie do Supabase.
4. Konto Anthropic (API key) + konto Voyage AI (embeddings) — trzymaj w env, nie w repo.

**Krok 1 — fundament auth i danych (2–3 dni)**
5. Supabase Auth: rejestracja/logowanie (email+hasło wystarczy na start, social login później).
6. Schema Drizzle: `profiles`, `experiences`, `job_offers`, `cv_versions`, `cover_letters`, `applications`.
7. RLS policy na każdej tabeli (`user_id = auth.uid()`) — testuj to zanim ruszysz dalej, nie na końcu.
8. i18n szkielet (`next-intl`), przełącznik PL/EN w UI.

**Krok 2 — profil i baza doświadczeń (3–4 dni)**
9. CRUD na `profiles` (dane kontaktowe, linki, edukacja).
10. CRUD na `experiences` (firma, rola, daty, opis, tagi/skille).
11. Agent generujący `ai_bullets` z surowego opisu (pierwszy realny prompt do Claude).

**Krok 3 — core loop: oferta → tailored CV (4–6 dni)**
12. Formularz wklejenia oferty pracy + Job Parser Agent (structured output: firma, rola, keywords, język).
13. Tailoring Agent v1 — bez RAG, cały profil w kontekście (masz mało danych na start, wystarczy).
14. Ekran podglądu structured CV (nie PDF) z możliwością edycji i akceptacji.
15. `@react-pdf/renderer` — eksport zaakceptowanej wersji do PDF (ATS-safe layout).

**Krok 4 — cover letter (2–3 dni)**
16. Cover Letter Agent (ten sam Job Parser + profil), osobny podgląd/edycja, osobny PDF template.

**Krok 5 — tracker aplikacji (2–3 dni)**
17. Przycisk "Zaaplikowałem" → zapis do `applications` (oferta + CV + cover letter + data).
18. Interview Prep Agent — odpala się przy zapisie, generuje pytania/talking points z różnicy CV vs oferta.
19. Dashboard listy aplikacji (status, szybki podgląd, filtrowanie).

**Krok 6 — RAG i samokontrola jakości (3–4 dni, dopiero jak baza urośnie)**
20. Generowanie embeddingów (Voyage) dla `experiences` przy zapisie.
21. Similarity search top-N zamiast całego profilu w Tailoring/Cover Letter Agent.
22. ATS Reviewer Agent — scoring + pętla poprawek (max 2 iteracje).

**Krok 7 — utwardzenie przed publicznym deployem (2–3 dni)**
23. Rate limiting per user (LLM calls/dzień), monitoring kosztów tokenów.
24. Test na prompt injection: wklej ofertę z ukrytą instrukcją ("ignoruj poprzednie polecenia...") i sprawdź, czy Job Parser się nie daje zwieść.
25. Audyt RLS — zaloguj się jako user A, spróbuj dobić się do danych usera B przez API.
26. Deploy produkcyjny (Vercel + Supabase prod), monitoring błędów (np. Sentry).

Realistyczny czas do w pełni działającego MVP (kroki 0–5, bez RAG): **2–3 tygodnie** pracy po godzinach. RAG i utwardzanie (kroki 6–7) dokładasz po tym, jak masz już żywy produkt i wiesz, że warto go skalować.

---

## 11. Logowanie przez Google

**Aktualizacja (sekcja 23): Better Auth zamiast Supabase Auth**, ale mechanika identyczna — to nadal gotowy provider, nie własny OAuth flow. Praktycznie:

1. Google Cloud Console → nowy projekt → OAuth consent screen (typ "External") → OAuth client ID.
2. Konfigurujesz social provider `google` w Better Auth (`socialProviders: { google: { clientId, clientSecret } }` w konfiguracji auth po stronie serwera).
3. Po stronie klienta: `authClient.signIn.social({ provider: "google" })` (klient Better Auth, analogicznie proste jak wcześniejsze Supabase).

Podstawowy login (imię, e-mail, avatar) to scope niewrażliwy — działa od razu, bez żadnej weryfikacji Google. Weryfikacja robi się dopiero wtedy, gdy dokładasz dodatkowe scope'y (kalendarz, mail — patrz punkt 14).

## 12. Płatności i cennik — realny rachunek kosztów tokenów

### Ile kosztuje wygenerowanie jednej aplikacji (ceny Anthropic/Voyage z lipca 2026)

Założenie: parsing/scoring (zadania klasyfikacyjne) na **Haiku 4.5** ($1/M wejście, $5/M wyjście), pisanie właściwej treści (CV, cover letter, interview prep) na **Sonnet 4.6** ($3/M wejście, $15/M wyjście) — to nie jest kaprys, to realna dźwignia kosztowa: Haiku jest 5–25x tańszy i wystarcza do ekstrakcji/oceny, nie potrzebujesz tam jakości Sonneta.

| Agent | Model | Wejście (tok.) | Wyjście (tok.) | Koszt |
|---|---|---|---|---|
| Job Parser | Haiku 4.5 | ~2 000 | ~400 | ~$0.004 |
| Tailoring (CV) | Sonnet 4.6 | ~5 000 | ~1 200 | ~$0.033 |
| ATS Reviewer (śr. 1,3 iteracji) | Haiku 4.5 | ~2 000 | ~400 | ~$0.004 |
| Cover Letter | Sonnet 4.6 | ~4 000 | ~700 | ~$0.0225 |
| Interview Prep (tylko po "Zaaplikowałem") | Sonnet 4.6 | ~2 500 | ~600 | ~$0.0165 |
| Embeddingi (Voyage, per zapis) | voyage-4 ($0.06/M) | — | — | ~$0.0001 (pomijalne) |

**CV bez cover letter**: Job Parser + Tailoring + ATS Reviewer ≈ **$0.04** (~0,16 zł przy kursie ~4 zł/$ — sprawdź aktualny kurs).
**CV + cover letter**: + Cover Letter Agent ≈ **$0.063** (~0,25 zł).
**CV + cover letter + interview prep**: ≈ **$0.08** (~0,32 zł).

Doliczam bufor bezpieczeństwa 2–3x na dłuższe oferty, powtórki, większe profile → realistycznie licz **0,50–1 zł kosztu tokenów na pełną aplikację** w najgorszym wypadku. To i tak jest praktycznie darmowe w porównaniu do jakiejkolwiek sensownej ceny subskrypcji.

Dodatkowa dźwignia, jeśli koszty urosną wraz ze skalą: **prompt caching** (Anthropic — 90% taniej na cache'owanym wejściu; profil użytkownika i system prompt nadają się do cache'owania między kolejnymi wywołaniami w tej samej sesji).

### Ile na tym zarobisz — przykładowa kalkulacja miesięczna

Założenia: 100 darmowych userów × 2 aplikacje/mies., 20 płacących userów × 15 aplikacji/mies., cena planu płatnego 39 zł/mies. (~$10):

| Pozycja | Kwota/mies. |
|---|---|
| Koszt tokenów (free: 100×2×$0.08 + paid: 20×15×$0.08) | ~$40 |
| Infrastruktura (Vercel + Neon + Cloudflare R2, mała skala) | ~$25–50 |
| Prowizja płatności (~3% od $200 przychodu) | ~$6 |
| **Przychód** (20 × $10) | **$200** |
| **Zysk brutto** | **~$100–130/mies.** przy 20 płacących userach |

Margines rośnie nieliniowo ze skalą — koszt tokenów jest praktycznie liniowy do liczby aplikacji, a przychód subskrypcyjny rośnie razem z liczbą płacących userów. Prawdziwym kosztem stałym na początku jest infrastruktura (~$25–50/mies.), nie tokeny.

### Model cenowy — do decyzji

Rekomendacja: **darmowy tier z twardym limitem** (np. 3 aplikacje/mies., bez cover letter, bez interview prep — to Twój "smak produktu") + **płatny plan** (np. 39–49 zł/mies. za 50 aplikacji/mies. z pełnym pakietem). Przy tym poziomie cen margines jest ogromny nawet po doliczeniu prowizji płatności.

### Bramka płatności — realny problem z BLIK

Stripe + Przelewy24 (najpopularniejsza polska metoda, BLIK ~54% udziału w e-commerce) **obsługuje tylko płatności jednorazowe — nie subskrypcje cykliczne**. Masz do wyboru:

- **Stripe (karta) jako subskrypcja** — standardowe podejście, działa dobrze (Netflix/Spotify tak robią w PL), ale część userów wyraźnie woli BLIK.
- **Pakiety kredytów jednorazowe przez Przelewy24/BLIK** (np. "10 aplikacji za 15 zł") zamiast subskrypcji — pasuje do ograniczenia P24, ale Ty zarządzasz rozliczeniem VAT sam.
- **Paddle / Lemon Squeezy** (Merchant of Record) — sami rozliczają VAT globalnie jako "reseller", więc nie musisz się rejestrować do VAT OSS w każdym kraju UE. Kosztuje więcej (~5% + opłata) niż Stripe (~1.5–2.9%), ale zdejmuje z Ciebie realny ból księgowy przy sprzedaży cyfrowej usługi konsumentom w UE. Nie sprawdziłem, czy obsługują BLIK bezpośrednio — do zweryfikowania przed wyborem.

To decyzja biznesowa, nie techniczna — jeśli nie chcesz na starcie ogarniać VAT MOSS/OSS, Paddle/Lemon Squeezy są prostsze kosztem wyższej prowizji.

## 13. Regulamin, polityka prywatności, cennik jako dokument

**Zastrzeżenie: nie jestem prawnikiem, to nie jest porada prawna.** Przy realnych płatnościach od konsumentów w UE i przetwarzaniu danych osobowych (CV to dane osobowe) regulamin i polityka prywatności nie są opcjonalne — i zanim wystartujesz publicznie z płatnościami, skonsultuj finalną wersję z prawnikiem (jednorazowa konsultacja kosztuje relatywnie niewiele w porównaniu z ryzykiem sporu konsumenckiego czy kary RODO).

Co musi się w tym znaleźć (szkielet do wypełnienia z prawnikiem, nie gotowy tekst):
- Dane usługodawcy (kto świadczy usługę — jednoosobowa działalność / spółka).
- Opis usługi, zasady rejestracji, zasady korzystania z konta.
- **Cennik** jako integralna część lub załącznik — jasne, co wchodzi w darmowy/płatny plan.
- Zasady płatności i **prawo do odstąpienia od umowy w 14 dni** (usługi cyfrowe w UE mają wyjątek — trzeba zebrać wyraźną zgodę usera na natychmiastowe rozpoczęcie świadczenia usługi i utratę tego prawa, inaczej user może zażądać zwrotu nawet po wykorzystaniu usługi).
- Polityka prywatności/RODO: jakie dane zbierasz (profil, doświadczenie zawodowe, treść ofert pracy, wygenerowane CV), na jakiej podstawie prawnej, komu je przekazujesz (Anthropic, Voyage, Neon, Cloudflare R2, dostawca płatności — to wszystko podprocesorzy, potrzebujesz z nimi/ich politykami zgodności DPA; Better Auth sam w sobie nie jest podprocesorem, bo działa w Twojej infrastrukturze, nie jako zewnętrzny serwis).
- Zasady reklamacji i zwrotów.

Praktyczna droga: generator regulaminu (np. polskie narzędzia typu "Generator Regulaminu") jako punkt startowy + jedna płatna konsultacja prawna przed publicznym launchem z płatnościami.

## 14. Integracja z Kalendarzem Google i skrzynką mailową

Te dwie integracje **różnią się drastycznie kosztem i czasem wdrożenia** — warto to wiedzieć zanim zaplanujesz je na tę samą sprintę.

**Kalendarz Google** (`calendar.events` — scope "sensitive", nie "restricted"): standardowa weryfikacja OAuth u Google (polityka prywatności, film demo, opis użycia) — bezpłatna, zwykle kilka-kilkanaście dni oczekiwania. Realne use case: przycisk "dodaj termin rozmowy do kalendarza" z ekranu aplikacji.

**Skrzynka mailowa (Gmail API)** — to jest dużo poważniejsza sprawa. Odczyt/dostęp do Gmaila to **scope "restricted"**, co wymaga:
- Corocznego audytu bezpieczeństwa **CASA Tier 2** — od 2026 dostępna tańsza self-serve ścieżka przez akredytowane laby, koszt **$540–1000** za skan (wcześniej $15 000–75 000 przy starej, ręcznej ścieżce).
- Do tego osobna weryfikacja Google — łączny czas **4–12+ tygodni** od zgłoszenia do zatwierdzenia.
- Coroczna re-certyfikacja (koszt cykliczny, nie jednorazowy).

Dla MVP jednoosobowego projektu to nieproporcjonalny koszt/czas na start. Rekomendacja: **odłóż integrację z Gmailem do fazy, w której produkt ma już płacących userów** i wiadomo, że warto zainwestować $500+ i 2–3 miesiące oczekiwania. Na start: user ręcznie wkleja treść oferty (masz to już w core loopie), a "połączenie ze skrzynką" możesz zastąpić prostszym substytutem — np. unikalnym adresem e-mail per user do przekierowania oferty (`twojnick@aplikuj.kandydo.app`), co daje 80% wartości bez dotykania Gmail API w ogóle.

## 15. Recenzje aplikacji (social proof)

To najlżejszy z dopisanych elementów — osobna tabela `testimonials` (imię/pseudonim, opcjonalnie firma/rola, treść opinii, ocena 1–5, `approved: boolean`), prosty formularz zgłoszeniowy dla zalogowanych userów + ręczna moderacja (Ty klikasz "approve") przed wyświetleniem na stronie głównej/landing page. Zero integracji zewnętrznych potrzebnych na start — ewentualny widget Trustpilot/Google Reviews to opcja na później, gdy będzie już realny ruch.

## 16. Gdzie to wpina się w plan krok po kroku z sekcji 10

- Google Login → dopisz do **Kroku 1** (auth), równolegle z logowaniem e-mail/hasło.
- Cennik + bramka płatności → nowy **Krok 7a** (przed hardeningiem z Kroku 7): integracja Stripe Billing (subskrypcja) + ewentualnie Przelewy24 (pakiety kredytów), webhook do aktualizacji statusu konta, blokada dostępu po przekroczeniu limitu darmowego tieru.
- Regulamin/polityka prywatności → **Krok 7b**, twardy wymóg przed publicznym launchem z płatnościami — nie startuj bez tego.
- Kalendarz Google → osobny **Krok 8** (post-MVP, po walidacji produktu) — niski koszt, można wcisnąć wcześniej jeśli chcesz.
- Gmail → **Krok 9**, świadomie odłożony w czasie (patrz sekcja 14) — traktuj jako "nice to have po trakcji", nie element MVP.
- Recenzje/testimoniale → dowolny moment, najlepiej równolegle z budową landing page (nie blokuje żadnego innego kroku).

---

## 17. Pivot: open source + BYOK zamiast płatnego SaaS (lub obok niego)

### Ważna korekta zanim ruszysz dalej — subskrypcja Claude.ai ≠ dostęp API

To, co opisujesz ("podpiąć swoją subskrypcję do Clauda"), **nie jest dziś możliwe zgodnie z regulaminem Anthropic**. Od kwietnia 2026 Anthropic wprost zabronił używania tokenów OAuth z planów Free/Pro/Max (czyli logowania "swoim Claude.ai") w jakimkolwiek zewnętrznym narzędziu — to narusza ich Consumer Terms of Service. OAuth z subskrypcji jest zarezerwowane wyłącznie dla Claude Code i claude.ai. Twoja apka na to nie ma wpływu — musi używać **klucza API z console.anthropic.com** (płatność pay-as-you-go za tokeny, osobne rozliczenie niż subskrypcja $20/mies. Claude.ai).

Praktyczna konsekwencja: user nie "podłączy swojego Claude Pro" — założy sobie osobne konto deweloperskie (Anthropic Console), doładuje kredyt (czy raczej po fakcie płaci), i wklei wygenerowany tam klucz API do Twojej apki. To nadal jest tanie (patrz sekcja 12 — grosze za aplikację), ale to nie jest "korzystanie z rzeczy, za którą już płacą".

### Co to realnie zmienia — model BYOK (Bring Your Own Key)

To i tak dobry pomysł, tylko z powyższą korektą. Ustalona nazwa dla tego wzorca: **BYOK** — masowo stosowany w OSS narzędziach AI (np. Kilo Code, Natively, Open CoDesign — wszystkie pozwalają wkleić własny klucz API zamiast płacić twórcy narzędzia). Co to daje:

- **Zero ryzyka kosztowego tokenów po Twojej stronie** — każdy request idzie na klucz API usera, Ty nic nie płacisz za jego zużycie. Cała matematyka z sekcji 12 (koszt/CV, marże) przestaje być Twoim problemem w tym trybie.
- **Znika potrzeba bramki płatności na starcie** — nie musisz w ogóle dotykać Stripe/Przelewy24/BLIK, żeby MVP działało. Realna redukcja zakresu.
- Regulamin/polityka prywatności nadal potrzebne (RODO obowiązuje niezależnie od tego, czy pobierasz pieniądze — przechowujesz profile i CV userów), ale bez klauzul o płatnościach/prawie odstąpienia — lżejszy dokument.

### Co trzeba dobudować technicznie

1. **Ekran "Ustawienia → Klucz API"** — user wkleja swój klucz Anthropic (opcjonalnie też OpenRouter, jeśli chcesz dać wybór modelu/providera bez zmiany kodu — OpenRouter przepuszcza requesty do Claude i wielu innych modeli jednym kluczem).
2. **Bezpieczne przechowywanie klucza** — to teraz Twój najbardziej wrażliwy sekret w bazie. Szyfruj at-rest w warstwie aplikacji (AES-256-GCM, klucz szyfrujący z `ENCRYPTION_KEY`/KMS — nie Supabase Vault, bo nie ma już Supabase, patrz sekcja 23), nigdy nie loguj, nie zwracaj w plaintext do frontu po zapisaniu (tylko "klucz ustawiony ✓" + możliwość nadpisania).
3. **Warstwa abstrakcji "resolve LLM credentials"** — jedna funkcja, która na starcie zwraca zawsze klucz usera (tryb BYOK), ale zaprojektowana tak, żeby później (patrz niżej) mogła zwrócić Twój pulowany klucz dla płacących userów planu Cloud. To jest to miejsce, które przygotowujesz pod przyszłą skalowalność, nie robiąc jej teraz.

### Skalowalność później = klasyczny model "open core"

Dokładnie to, o czym piszesz ("zrobić skalowalność z tym później") ma nazwę i sprawdzone precedensy: **open core** — dokładnie tak działają n8n, PostHog, Cal.com, Supabase. Mechanika:

- **Dziś**: kod open source (self-hosted albo Twoja hostowana instancja), tryb BYOK — darmowe dla Ciebie w utrzymaniu, user płaci tylko za własne tokeny.
- **Później**: dokładasz opcjonalny płatny plan **"Cloud"** dla ludzi, którzy nie chcą zakładać konta Anthropic Console i wklejać kluczy — Ty zarządzasz pulą kluczy, doliczasz swoją marżę do ceny (cały rachunek z sekcji 12 wraca w tym momencie, 1:1 gotowy do użycia), i to jest moment, w którym realnie potrzebujesz Stripe/Przelewy24/regulaminu z klauzulami płatności.
- Kod się nie zmienia strukturalnie — warstwa z punktu 3 wyżej po prostu zaczyna zwracać inny klucz w zależności od planu usera.

### Licencja — to ma znaczenie przy tym planie

Jeśli chcesz w przyszłości sam zarabiać na hostowanej wersji, **MIT nie chroni Cię przed tym, że ktoś weźmie Twój kod i odpali identyczny hostowany serwis szybciej niż Ty**. Rekomendacja: **AGPL-3.0** — pozwala każdemu forkować/self-hostować za darmo, ale jeśli ktoś hostuje zmodyfikowaną wersję jako usługę sieciową, musi upublicznić swoje zmiany. To standardowy wybór w dokładnie tym scenariuszu (open core + plan na własny hosting) i tak licencjonują się realne projekty w tej samej niszy (np. serwerowa część Frontmana, cały Natively).

### Co odpada / co zostaje z wcześniejszego planu

- **Odpada z MVP**: Krok 7a (Stripe/Przelewy24), część sekcji 12 dot. cennika i marż — nieaktualne, dopóki nie uruchomisz planu Cloud.
- **Zostaje bez zmian**: cały stack (sekcja 1), model danych (sekcja 2), RAG (sekcja 3), agenci AI (sekcja 4), i18n + cover letter (sekcja 9), Google login (sekcja 11 — nadal przydatny, teraz też jako łatwiejszy onboarding do OSS), kalendarz/Gmail (sekcja 14 — uwaga o CASA nadal aktualna, jeśli kiedyś hostujesz to publicznie).
- **Nowy krok w planie z sekcji 10**: dopisz do **Kroku 2** (profil) ekran "Ustawienia → Klucz API" zamiast czekać do końca — to teraz część rdzenia produktu, nie dodatek.

---

## 18. Domknięcie: nazwa na Europę/USA, PWA offline, kalendarz in-app, hak pod maila

### Nazwa — sanity check pod szerszy rynek

**Kandydo** dalej się broni: sprawdziłem pod kątem niechcianych skojarzeń w innych językach europejskich — nic nie wypłynęło (nie jest to istniejące słowo z negatywnym znaczeniem w niemieckim/francuskim/hiszpańskim/włoskim). Ciekawostka na plus: w esperanto "kandido" też znaczy "kandydat" — ta sama łacińska podstawa co polskie słowo, więc brzmi swojsko w całej Europie, nie tylko w Polsce. Fonetycznie łatwe dla anglojęzycznych (czyta się intuicyjnie, bez polskich znaków w samej nazwie — ważne pod domenę/wymowę w USA). Zostaje jako rekomendacja, z tym samym zastrzeżeniem co wcześniej: zweryfikuj domenę/znak towarowy ręcznie przed finalną decyzją.

### PWA — co realnie będzie działać offline, a co nie

Rekomendacja narzędziowa: **Serwist** (aktywnie rozwijany fork Workboxa, rekomendowany wprost w oficjalnej dokumentacji Next.js) — nie next-pwa, który od lat nie jest aktualizowany.

Ważne, żeby nie obiecać sobie za dużo: **generowanie nowego CV zawsze wymaga sieci** (wywołanie Claude), offline tego nie obejdziesz. To, co realnie zyskujesz z PWA:
- **App shell ładuje się natychmiast** nawet bez sieci (zero białego ekranu), ikona na pulpicie telefonu jak natywna apka.
- **Podgląd wcześniej wygenerowanych CV/cover letterów, profilu i listy aplikacji offline** — dane cache'owane lokalnie (IndexedDB), więc np. w metrze bez zasięgu możesz sobie odświeżyć, co przygotowałeś na rozmowę.
- **Edycja profilu/doświadczeń offline z synchronizacją po powrocie sieci** (background sync) — możesz dopisać projekt do bazy doświadczeń bez internetu, zapisze się jak wróci połączenie.

To wystarczy technicznie zrobić w ramach Kroku 2/3 z sekcji 10 (manifest.json, service worker przez Serwist, cache strategy dla API GET-ów i statyki) — nie jest to osobna duża faza.

### Kalendarz — wersja lekka teraz, hak pod Google Calendar później

Zamiast integracji z Google Calendar (odłożonej, sekcja 14), rób dwie tanie rzeczy teraz:

1. **Prosty widok kalendarza in-app** w trackerze aplikacji — pola `interview_at` (data/godzina) i `interview_notes` w tabeli `applications` (już masz tę tabelę z sekcji 2), renderowane jako lista/widok miesięczny w UI. Zero zewnętrznych API.
2. **Eksport `.ics` jednym kliknięciem** — z zapisanego terminu rozmowy generujesz plik `.ics` (biblioteka `ics` w npm, kilka linijek kodu) do pobrania/otwarcia — user wrzuca to do Google Calendar, Apple Calendar czy Outlooka ręcznie, bez żadnego OAuth. To pokrywa 90% realnej potrzeby ("chcę mieć termin rozmowy w kalendarzu") bez kosztu i czasu integracji z sekcji 14.

Kiedy wrócisz do prawdziwej synchronizacji Google Calendar, `interview_at`/`interview_notes` to już gotowe pole źródłowe do push/pull przez Calendar API — nic nie przerabiasz w modelu danych.

### Odczytywanie odpowiedzi z maila — hak, bez budowy teraz

Zgodnie z Twoim priorytetem, to zostaje odłożone (i to bez dotykania Gmail API/CASA wcale, kiedy przyjdzie czas): najtańsza droga to **unikalny alias e-mail per user** (`user123@aplikuj.kandydo.app`) + usługa typu Mailgun/Postmark z inbound parsing — rekruter odpowiada, user robi "forward" na swój alias, webhook odbiera treść, agent AI wyciąga z niej info (termin rozmowy, status) i aktualizuje `applications`. To zupełnie inna, dużo lżejsza ścieżka niż czytanie samej skrzynki Gmail usera — nie wymaga w ogóle Google OAuth/CASA. Nic z tego nie buduj teraz — wystarczy, że wiesz, iż nie jest to droga przez Gmail API, gdy do tego wrócisz.

## 19. Optymalizacja pod pisanie kodu przez agenta (Claude Code / Cowork)

Żeby to sprawnie szło jako praca agentów kodujących (Twój oryginalny pomysł z podziałem: orchestrator + agenci per-obszar + review), warto ustawić repo tak, żeby każda sesja agenta (zaczynająca "na zimno", bez pamięci poprzednich sesji) miała jak najmniej do odkrycia:

1. **`CLAUDE.md` w rootcie repo** — jeden plik, który czyta każdy agent na starcie: cel produktu, mapa folderów, konwencje nazewnictwa, dokładne komendy (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`), lista zmiennych środowiskowych (bez wartości), zasada "Zod schema = kontrakt, zmieniasz schema → aktualizujesz wszystkich konsumentów".
2. **Struktura per-feature, nie per-typ-pliku** — `/features/cv-tailoring/`, `/features/applications/`, `/features/auth/`, `/features/profile/`, każdy ze swoimi komponentami, route handlerami i schematami razem. Agent pracujący nad jednym feature'em nie musi czytać całego repo, żeby zrozumieć kontekst — ogranicza to zużycie kontekstu i ryzyko pomyłek.
3. **Zod schematy w jednym współdzielonym miejscu** (`/lib/schemas`) jako **jedyne źródło prawdy** o kształcie danych między frontem, backendem i agentami AI (`generateObject` używa dokładnie tych samych schematów co UI i baza przez Drizzle-Zod). Agent budujący frontend i agent budujący AI-pipeline pracują na tym samym kontrakcie, nie zgadują.
4. **Małe, jednoznaczne zadania** zamiast dużych epików — ticket dla agenta powinien wskazywać dokładne pliki/schematy do zmiany, nie "zrób tracker aplikacji" tylko np. "dodaj pole `interview_at`/`interview_notes` do schematu `applications` w `/lib/schemas/applications.ts`, zaktualizuj migrację Drizzle, dodaj input w formularzu `/features/applications/InterviewForm.tsx`".
5. **Fixture'y/przykłady dla promptów AI-pipeline** — kilka przykładowych ofert pracy + oczekiwany structured output w `/lib/schemas/__fixtures__` — pozwala agentowi (i Tobie) sprawdzić deterministycznie, czy zmiana promptu czegoś nie zepsuła, bez ręcznego klikania w UI za każdym razem.
6. **Git worktree per obszar** (backend/frontend/ai-pipeline/devops) — kilka równoległych sesji agentów bez nadpisywania sobie zmian; agent-review scala do main po sprawdzeniu.
7. **Agent-review jako bramka przed merge** — checklista w `CLAUDE.md`: RLS na nowych tabelach, brak sekretów/kluczy w diffie, treść oferty pracy nigdy nie trafia jako część system prompta (injection), `pnpm typecheck && pnpm test` przechodzi. Agent sam odpala te komendy i raportuje wynik zamiast Ciebie o to prosić.
8. **`DECISIONS.md`** — krótki dziennik decyzji ("dlaczego BYOK, nie Stripe na starcie", "dlaczego Serwist, nie next-pwa", "dlaczego AGPL") — świeża sesja agenta czyta to w 30 sekund zamiast ponownie odkrywać kontekst tej całej rozmowy.

## 20. Skonsolidowany plan krok po kroku (wersja finalna)

Zastępuje/aktualizuje listę z sekcji 10 pod najnowsze decyzje: bez cennika, bez Google Calendar/Gmail, z PWA i kalendarzem in-app, z BYOK jako rdzeniem od początku.

**Krok 0 — przygotowanie (1 dzień)**
1. Finalna nazwa + domena + repo GitHub, licencja **AGPL-3.0** w pliku `LICENSE`.
2. `CLAUDE.md` + `DECISIONS.md` w rootcie (sekcja 19) — zanim jeszcze napiszesz linijkę kodu.
3. `docker-compose up` (Postgres lokalnie + `pgvector`, opcjonalnie MinIO) + `create-next-app` (TS, App Router) + Drizzle + Neon (produkcyjna baza) + Better Auth + Cloudflare R2.

**Krok 1 — fundament: auth, dane, i18n, PWA szkielet (3–4 dni)**
4. Better Auth: e-mail/hasło + **Google Login** (sekcja 11 — łatwiejszy onboarding, niewrażliwy scope).
5. Schema Drizzle: `profiles`, `experiences`, `job_offers`, `cv_versions`, `cover_letters`, `applications` (z `interview_at`/`interview_notes`), `testimonials`.
6. RLS na każdej tabeli — testuj od razu, nie na końcu.
7. `next-intl` (PL/EN), przełącznik języka UI.
8. Serwist + `manifest.json` + ikony → instalowalna PWA z cache'em app-shell od pierwszego dnia.

**Krok 2 — profil, doświadczenia, klucz API (3–4 dni)**
9. CRUD `profiles`/`experiences`.
10. **Ekran "Ustawienia → Klucz API"** (BYOK) — szyfrowane przechowywanie (AES-256-GCM w warstwie aplikacji, klucz szyfrujący z `ENCRYPTION_KEY`/KMS, nie plaintext w Postgresie), walidacja klucza (jeden testowy request do Anthropic przy zapisie).
11. Agent generujący `ai_bullets` z surowego opisu (pierwszy realny prompt, Haiku).
12. Cache offline (IndexedDB) dla profilu/doświadczeń — działa do przeglądania bez sieci.

**Krok 3 — core loop: oferta → tailored CV (4–6 dni)**
13. Job Parser Agent (Haiku, structured output: firma/rola/keywords/język).
14. Tailoring Agent v1 (Sonnet, bez RAG na start).
15. Podgląd structured CV + edycja + akceptacja.
16. `@react-pdf/renderer` → eksport PDF (ATS-safe).

**Krok 4 — cover letter (2–3 dni)**
17. Cover Letter Agent + osobny podgląd/PDF.

**Krok 5 — tracker aplikacji + kalendarz in-app (3–4 dni)**
18. "Zaaplikowałem" → zapis do `applications`.
19. Interview Prep Agent (po zapisie).
20. Widok kalendarza in-app (`interview_at`) + **eksport `.ics`** jednym klikiem.
21. Dashboard/lista aplikacji, cache offline dla podglądu.

**Krok 6 — RAG i samokontrola jakości (3–4 dni, dopiero jak baza urośnie)**
22. Embeddingi (Voyage) dla `experiences`.
23. Similarity search zamiast całego profilu w kontekście.
24. ATS Reviewer Agent + pętla poprawek (max 2 iteracje).

**Krok 7 — utwardzenie przed publicznym deployem (2–3 dni)**
25. Rate limiting per user (nie kosztowe — Ty nie płacisz za tokeny — tylko antyspamowe: limit rejestracji, limit requestów/minutę).
26. Minimalna polityka prywatności/regulamin (RODO — przechowujesz dane osobowe niezależnie od tego, że nie ma płatności; bez klauzul o płatnościach/odstąpieniu, patrz sekcja 13).
27. Test na prompt injection (wklejona oferta z ukrytą instrukcją).
28. Audyt RLS (user A nie widzi danych usera B).
29. Deploy (Vercel + Neon prod) + monitoring błędów.

**Odłożone świadomie na później** (nie blokują MVP): Krok 8 — Google Calendar sync (sekcja 14, tania część), Krok 9 — Gmail/inbound e-mail (sekcja 18, przez alias+Mailgun, nie przez Gmail API), Faza Cloud — płatny plan hostowany dla ludzi bez własnego klucza API (sekcja 17, cały rachunek z sekcji 12 czeka gotowy do odpalenia).

Realistyczny czas do MVP (Kroki 0–5): **3–4 tygodnie** pracy po godzinach (trochę więcej niż poprzednia wersja planu — PWA i kalendarz in-app dokładają dni, ale nie tygodnie). Dochodzi jeszcze punkt z sekcji 21 (kredyty/płatność za "mój klucz") — wciśnij go między Krok 6 a Krok 7.

---

## 21. Model hybrydowy od dnia 1: BYOK + "użyj mojego klucza" na przedpłacone kredyty

### Najpierw ważne rozróżnienie: prompt injection ≠ ryzyko kosztowe

To dwa osobne problemy i dobrze je rozdzielić, bo inaczej się je zabezpiecza:

- **Prompt injection** (ukryta instrukcja w wklejonej ofercie pracy próbująca zmienić zachowanie agenta) — to ryzyko dla **jakości/treści** (np. agent podmieni fakty w CV, zignoruje zasadę prawdziwości) i **bezpieczeństwa danych** (próba wyciągnięcia czegoś z kontekstu). Zabezpieczasz to strukturalnie: dane usera nigdy nie są częścią system prompta, output zawsze wymuszony przez Zod schema (`generateObject`) — model fizycznie nie może "wygadać się" poza zdefiniowaną strukturą.
- **Ryzyko kosztowe/finansowe DoS** — to zupełnie inny wektor: ktoś odpytuje Twój endpoint dużo razy albo próbuje wymusić maksymalnie długą odpowiedź. Tego **nie da się zrobić przez samą treść promptu** — obie rzeczy kontrolujesz Ty, po stronie serwera, niezależnie od tego, co ktoś wklei jako "ofertę pracy":
  - `max_tokens` na każdym wywołaniu Claude API — to twardy limit API, treść promptu nie może go ominąć. Najgorszy przypadek pojedynczego requestu jest więc **z góry znany i policzalny w dolarach**, niezależnie od żadnej próby manipulacji.
  - Limit długości wklejanego tekstu (np. 6000 znaków na ofertę pracy) egzekwowany po stronie serwera przed wysłaniem czegokolwiek do Anthropic.
  - Brak autonomicznych, wieloetapowych pętli agentowych z narzędziami (Twoi agenci z sekcji 4 to pojedyncze, ograniczone wywołania — Job Parser → Tailoring → max 2 iteracje ATS Reviewer, nigdy "rób, aż skończysz"). To jest kluczowe: prawdziwie niebezpieczne finansowo są autonomiczne agenty z pętlą tool-callingu bez twardego limitu kroków — Ty takiego wzorca świadomie nie budujesz nigdzie w tym planie.

Czyli: nawet najbardziej złośliwie napisana oferta pracy nie może wygenerować kosztu wyższego niż `(max_tokens output) + (capped input)` pojedynczego wywołania — a to jest liczba, którą znasz z góry i możesz wycenić.

### Mechanizm, który realnie chroni Cię przed zbankrutowaniem

To, co faktycznie musi się spiąć, to nie "obrona przed injection", tylko **twardy, atomowy limit wydatków per user na Twoim kluczu**:

1. **Kredyty przedpłacone, nie postpaid** — `profiles.credits_balance` (liczba całkowita, np. w "generacjach" albo centach). Zero trybu "użyj i zapłać później" — to jedyny sposób, żeby matematycznie wykluczyć zadłużenie się na Twoim koncie Anthropic.
2. **Sprawdzenie i rezerwacja kredytu PRZED wywołaniem Claude API, nie po** — atomowa transakcja w Postgresie (`UPDATE profiles SET credits_balance = credits_balance - X WHERE user_id = ? AND credits_balance >= X`, sprawdzasz `rowCount`), z `CHECK (credits_balance >= 0)` jako drugą linią obrony na poziomie bazy. Jeśli update nie przeszedł (bo za mało kredytów) — request do Anthropic **w ogóle się nie wykonuje**. Zero szans na "ups, wyszło na minus".
3. **Rate limiting per user** (np. Upstash Redis albo licznik w Postgresie) — limit requestów/minutę i /dzień, niezależnie od salda kredytów. Chroni przed skryptowym spamem/bugiem w pętli, nie tylko przed złą wolą.
4. **Idempotency key per akcja generowania** — jedno kliknięcie "generuj CV" = jedno obciążenie, nawet jeśli user kliknie 5x albo request się powtórzy przez retry sieciowy.
5. **Log użycia per request** (`usage_log`: user_id, agent, model, tokeny in/out, koszt, timestamp) — nie tylko do rozliczeń, ale jako **wykrywanie anomalii**: jeśli jeden user normalnie robi 2 CV/dzień, a nagle 200 w godzinę, to widać to natychmiast w logu i możesz dorzucić alert (np. webhook na Slack/mail do Ciebie) zanim to urośnie do realnej kwoty.
6. **Dodatkowy, twardy dzienny limit generacji per user** nawet przy dużym saldzie kredytów (np. maks. 20/dzień) — pas i szelki: spowalnia każdy zautomatyzowany nadużywający wzorzec, zanim zdążysz zareagować ręcznie.

Efekt: matematycznie nie możesz stracić więcej niż to, co ktoś wcześniej zapłacił, bo request do Anthropic po prostu się nie wykona bez pokrycia w saldzie. To jest dużo mocniejsza gwarancja niż jakikolwiek filtr "wykrywający" złośliwy prompt.

### Płatność — BLIK i karta, bo to jednorazowe zakupy, nie subskrypcja

Dobra wiadomość: skoro to są **kredyty kupowane z góry** (nie recurring subskrypcja), znika cały problem z sekcji 12 ("Przelewy24 nie obsługuje subskrypcji") — **Stripe Checkout w trybie jednorazowym obsługuje natywnie Przelewy24 (czyli BLIK) i karty w tym samym flow**. Jeden config, dwie metody płatności, bez osobnej integracji P24. User kupuje np. "pakiet 10 generacji", Stripe potwierdza płatność, webhook dolicza kredyty do `credits_balance`. Prościej niż wcześniej planowana subskrypcja.

Wycena pakietu: bierzesz worst-case koszt pojedynczej generacji z sekcji 12 (z buforem, ~0,50–1 zł), dokładasz swoją marżę + pokrycie prowizji Stripe (~1,5–2,9%) → np. "10 generacji CV+cover letter za 15–19 zł" jako punkt startowy, do skorygowania po pierwszych realnych danych z `usage_log`.

### Co to zmienia w modelu danych i planie

Nowe tabele: `credits_ledger` (user_id, delta, powód: zakup/zużycie/refund, timestamp — pełna historia, nie tylko bieżące saldo), `usage_log` (jak wyżej). Pole `profiles.credits_balance` jako zdenormalizowany, szybki odczyt (źródło prawdy to suma z `credits_ledger`, `credits_balance` to cache aktualizowany w tej samej transakcji).

W planie z sekcji 20: dopisz **Krok 6.5** — implementacja `credits_ledger`/`usage_log`, atomowy check-and-deduct przed każdym wywołaniem agenta, Stripe Checkout (one-time, P24+karta), webhook doliczający kredyty, rate limiting, dzienny hard cap. To rdzeń bezpieczeństwa finansowego dla trybu "użyj mojego klucza" — nie odkładaj tego na koniec, bo bez tego nie powinieneś w ogóle włączać tej opcji publicznie.

## 22. Struktura plików repo

```
kandydo/
├── .claude/
│   └── agents/
│       └── code-reviewer.md        # subagent review, read-only (Read/Grep/Glob/Bash)
├── docs/
│   ├── architecture.md             # ten dokument (sekcje 1–22)
│   └── DECISIONS.md                # dziennik decyzji
├── CLAUDE.md                       # zostaje w rootcie — Claude Code czyta go stąd automatycznie
├── LICENSE                         # AGPL-3.0
├── .env.example
├── package.json / tsconfig.json / next.config.ts / drizzle.config.ts
├── messages/                       # next-intl katalogi tłumaczeń
│   ├── en.json
│   └── pl.json
├── public/
│   ├── manifest.json                # PWA
│   └── icons/
└── src/
    ├── middleware.ts                 # routing i18n + auth
    ├── app/                          # Next.js App Router — tylko routing/layout, minimum logiki
    │   ├── (marketing)/               # landing page, testimoniale
    │   ├── (app)/                     # zalogowana część: profile/ applications/ settings/ ...
    │   └── api/                       # route handlery, webhooki (Stripe itd.)
    ├── features/                     # logika domenowa, per-feature
    │   ├── auth/
    │   ├── profile/
    │   ├── cv-tailoring/
    │   ├── cover-letter/
    │   ├── applications/              # tracker + kalendarz in-app + eksport .ics
    │   ├── credits/                   # kredyty, Stripe checkout, usage_log
    │   └── settings/                  # BYOK — ekran "klucz API"
    └── lib/
        ├── schemas/                   # Zod — jedyne źródło prawdy o kształcie danych
        │   └── __fixtures__/          # przykładowe oferty pracy + oczekiwany output
        ├── ai/                        # definicje agentów, jeden plik = jeden agent
        │   ├── job-parser.ts
        │   ├── tailoring.ts
        │   ├── ats-reviewer.ts
        │   ├── cover-letter.ts
        │   └── interview-prep.ts
        ├── db/                        # Drizzle schema + migracje + klient Postgres
        └── auth/                      # konfiguracja Better Auth (Google OAuth + email/hasło)
```

Kilka zasad co do tego układu:

- **`CLAUDE.md` zostaje w rootcie, nie w `docs/`** — to jedyny plik, który Claude Code automatycznie wczytuje na start sesji z tej lokalizacji. `docs/architecture.md` i `docs/DECISIONS.md` są odsyłaczami z niego (agent czyta je, jeśli potrzebuje głębszego kontekstu), ale sam `CLAUDE.md` ma zostać krótki i skanowalny.
- **`.claude/agents/`** to konwencja Claude Code — pliki stąd są wykrywane automatycznie, nic nie trzeba dodatkowo konfigurować poza samym plikiem `code-reviewer.md`.
- **`src/features/` odzwierciedla dokładnie agentów z sekcji 4 i kroki z sekcji 20** — każdy feature-folder to w praktyce jeden spójny kawałek pracy dla jednej sesji/agenta, bez potrzeby czytania całego repo.
- **`src/app/` ma być cienki** — routing, layout, wywołania do `features/`. Cała logika biznesowa leży w `features/`, nie w `app/`, żeby przyszła zmiana routingu (albo migracja frameworka) nie ruszała logiki.
- `src/` jest opcjonalny (Next.js działa tak samo z `app/` w rootcie), ale trzyma pliki configów/dokumentacji wizualnie oddzielone od kodu aplikacji — przy repo tej wielkości warto.

---

## 23. Zmiana: Postgres własny zamiast Supabase-BaaS, TanStack Query + Zustand, Docker

### Najpierw rozdzielenie warstw — Drizzle i TanStack Query to nie alternatywy

To częste pomieszanie, więc wprost: **Drizzle działa po stronie serwera** (route handler/Server Action ↔ Postgres — query builder, migracje, typy). **TanStack Query działa po stronie klienta** (komponent React ↔ Twoje API — cache, refetch, mutacje, optimistic updates). To dwie różne granice tej samej apki, nie dwa konkurujące rozwiązania tego samego problemu — w realnym fullstacku używasz obu naraz. RTK Query (część Redux Toolkit) odrzucony, bo ciągnąłby całą maszynerię Reduxa bez potrzeby innego globalnego store'u — TanStack Query jest lżejszy, bardziej rozpoznawalny na rynku i nie wymaga tego bagażu.

### Dlaczego zejście z Supabase na "gołego" Postgresa

Uzasadnienie: chcesz, żeby ten projekt pokazywał, że "dowozisz wszystko" — Supabase jako BaaS część tej pracy robi za Ciebie (auth, storage, RLS-wiring), co jest dobrą inżynierską decyzją produkcyjnie, ale słabiej pokazuje konkretne umiejętności na CV. Zejście na warstwę niżej pokazuje więcej realnych kompetencji, kosztem trochę większego zakresu pracy.

Nowy zestaw (**PostgreSQL + Drizzle + Better Auth** to zresztą sam z siebie uznany w 2026 standard tego typu stacku, nie tylko "portfolio hack"):

- **PostgreSQL** — Docker lokalnie (`docker-compose.yml`: kontener Postgres + opcjonalnie MinIO jako lokalna emulacja S3), **Neon** w produkcji (serverless Postgres, branch-per-PR do preview environments — kolejna konkretna rzecz do wymienienia jako umiejętność). Alternatywa: pełny self-host Postgresa na VPS przez Docker, jeśli chcesz jeszcze więcej "zrobiłem to sam" — więcej administracji, mniej wygody.
- **Better Auth** zamiast Supabase Auth — w pełni self-hosted (kod auth leży w Twoim repo, sesje w Twoim Postgresie, zero zewnętrznej zależności), natywne providery (Google OAuth od razu), wtyczki (rate limiting — pokrywa się z potrzebą z sekcji 21, RBAC/organizacje gdyby kiedyś potrzebne). Oficjalny adapter do Drizzle.
- **Cloudflare R2** (S3-compatible) zamiast Supabase Storage — przechowywanie wygenerowanych PDF-ów, tanie, bez opłat za egress.
- **RLS bez Supabase**: Postgres RLS to natywna funkcja bazy, nie coś, co ma tylko Supabase — trzeba ją tylko samemu okablować. Podejście: session variable ustawiana per-request wewnątrz transakcji (`SET LOCAL app.current_user_id = $1`), polityki RLS na tabelach jak wcześniej. Do tego druga warstwa obrony w kodzie aplikacji: helper w `/lib/db` wymuszający `.where(eq(table.userId, ctx.userId))` w każdym query — nie polegaj tylko na jednej warstwie. To więcej pracy niż "Supabase robi to za Ciebie", ale dokładnie ten rodzaj pracy, który chcesz umieć pokazać.

### Docker — do czego dokładnie

`docker-compose.yml` w rootcie: kontener Postgres (+ MinIO, jeśli chcesz też lokalnie emulować R2) — jedna komenda uruchamia całe środowisko dev bez instalowania Postgresa na maszynie. Dodatkowo `Dockerfile` dla samej aplikacji Next.js — nie jest potrzebny do deployu na Vercel, ale otwiera realną ścieżkę self-hostingu dla innych (spójne z licencją AGPL i planem open source z sekcji 17): ktoś może odpalić cały projekt jednym `docker-compose up` na własnym VPS.

### Co się zmienia w strukturze plików (sekcja 22)

- `src/lib/supabase/` → **`src/lib/db/`** (klient Drizzle + connection pool do Postgresa) i **`src/lib/auth/`** (konfiguracja Better Auth).
- Nowe pliki w rootcie: `docker-compose.yml`, `Dockerfile`, `.dockerignore`.
- Zmienne środowiskowe: `DATABASE_URL` (Neon/Docker Postgres), `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` — zastępują `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` z wcześniejszych sekcji.

### Co zostaje bez zmian

Cała reszta planu (RAG/pgvector, agenci AI z sekcji 4, model kredytów z sekcji 21, PWA/Serwist, i18n, licencja AGPL, kalendarz in-app) jest niezależna od tego, czy bazę hostuje Supabase czy Neon — to wymiana jednej warstwy infrastruktury, nie zmiana architektury produktu.

---

## 24. Warstwa "pokazania się" — co jeszcze dopisać pod portfolio

To rzeczy, które nie wpływają na to, czy apka działa, tylko na to, czy ktoś zobaczy i doceni, że działa dobrze. Priorytet na końcu.

1. **README jako pierwsza strona portfolio, nie opis techniczny** — GIF/krótkie wideo pokazujące cały flow (profil → wklejona oferta → tailored CV → PDF) w ~20 sekund, link do live demo, badge'e (CI passing, licencja, coverage), stack z linkami. To pierwsza rzecz, którą zobaczy rekruter klikający link z CV — częściej przeczyta README niż kod.
2. **Publiczne demo z danymi-atrapami, bez rejestracji** — tryb "guest" z gotowym przykładowym profilem, żeby ktokolwiek mógł kliknąć i zobaczyć działanie bez zakładania konta czy wklejania klucza API. Realnie podnosi szansę, że ktoś to w ogóle sprawdzi zamiast zamknąć kartę.
3. **Dwa osobne case studies, nie jeden** — to często mylone, a to różne dowody różnych umiejętności:
   - **Case study produktowy** — architektura apki: dlaczego RAG dopiero po skali, mechanizm kredytów, BYOK, AGPL.
   - **Case study procesu** ("jak zbudowałem to z agentami AI") — to jest odpowiedź na "chcę pokazać, że zajmowałem się orkiestracją agentów **do developmentu**", nie to, jak agenty działają w produkcie. Materiał na to już istnieje w repo, tylko trzeba go wyeksponować, nie zakopać: `CLAUDE.md` jako dokument onboardingowy dla agenta (konwencje, twarde zasady, zatwierdzone zależności), `docs/DECISIONS.md` jako żywy log decyzji architektonicznych (dokładnie to, co powstało w tej rozmowie), `.claude/agents/code-reviewer.md` jako bramka jakości z restrykcyjnym dostępem do narzędzi (read-only), plus `/security-review` i GitHub Action `claude-code-action` jako druga, automatyczna warstwa review widoczna publicznie w historii PR-ów. Zlinkuj to wprost z README ("Zobacz jak to zbudowałem z orkiestracją agentów AI →") zamiast traktować jako szczegół implementacyjny.
   - Dodatkowo: konwencja commitów/PR-ów wskazująca, która "rola agenta" (backend/frontend/ai-pipeline/devops z sekcji 19) zrobiła co — wtedy `git log`/historia PR-ów sama w sobie jest czytelnym dowodem procesu, nie tylko jedną nieodróżnialną kupką commitów.
4. **CI z realnym zielonym badge'm w README** — GitHub Actions: typecheck/lint/test/build + `claude-code-security-review` na każdym PR. Konkretny, sprawdzalny dowód, nie tylko deklaracja "mam testy".
5. **Lighthouse/PWA score jako liczba do pokazania** — skoro to PWA, dopilnuj wysokiego wyniku (Performance/Accessibility/Best Practices/SEO/PWA) i wrzuć screenshot do README. Lighthouse CI w pipeline, żeby wynik się nie psuł po drodze.
6. **Dostępność (a11y)** — shadcn/ui na Radix daje to w dużej mierze "za darmo" (fokus, aria, klawiatura), ale warto to jawnie przetestować (axe-core w CI) i wspomnieć — mało kto w portfolio-projektach w ogóle o tym myśli.
7. **Dark mode** — trywialne z Tailwind+shadcn (jeden toggle), typowy sygnał "dopracowane".
8. **RODO: eksport i usunięcie danych przez użytkownika** — jeden przycisk "pobierz moje dane"/"usuń konto" w Ustawieniach. Poza wymogiem prawnym, konkretny dowód, że rozumiesz compliance, nie tylko hasło "RODO" w regulaminie.
9. **Higiena OSS repo** — `CONTRIBUTING.md`, szablony issue/PR, topics/tagi (odkrywalność), `CHANGELOG.md` z semantic versioning. Przy licencji AGPL i celu w gwiazdki na GitHubie to różnica między repo, które ktoś znajdzie i zostawi, a martwym forkiem.
10. **Dependabot/Renovate** — automatyczne PR-y z aktualizacjami zależności, jedna linijka configu, sygnał "dbam o bezpieczeństwo" bez ręcznej pracy.

**Priorytet**: 1, 2 i 3 dają najwięcej efektu na jednostkę czasu — README + demo + case study to rzeczy, które ktoś faktycznie zobaczy, w przeciwieństwie np. do Dependabota, którego nikt nie sprawdza ręcznie.

---

## 25. Design system + widoczna orkiestracja agentów (żeby dało się to komuś pokazać)

### Design system — konkretne zasady, nie "ładnie zrobię"

- **Font**: Geist Sans + Geist Mono (`next/font`, pakiet `geist` od Vercela) — darmowy, nowoczesny, zero konfiguracji, naturalnie pasuje do shadcn/ui.
- **Kolory**: jeden bazowy motyw shadcn (np. Zinc/Slate) + jeden zdefiniowany kolor akcentu jako tożsamość marki Kandydo, tokeny light/dark w Tailwind v4 `@theme`. Dark mode jako toggle od początku (trywialne z tym stackiem, duży efekt wizualny).
- **Stany UI jako pierwszorzędne, nie dopisywane na końcu**: skeleton loadery (`Skeleton` z shadcn) na każdy ekran czekający na dane, jasne empty states ("nie masz jeszcze żadnych doświadczeń — dodaj pierwsze"), error boundary z przyjaznym komunikatem zamiast białego ekranu.
- **Ruch/animacje**: darmowe utility Tailwinda (`transition`, `animate-*`) do mikrointerakcji — zero nowej zależności. Realna biblioteka animacji tylko, jeśli wizualizacja pipeline'u (niżej) tego wymaga, i wtedy jawnie dopisana do listy w `CLAUDE.md`.
- **Ikony i spacing**: lucide-react, jedna skala rozmiarów; domyślna skala spacingu Tailwinda, bez własnych wartości "na oko".

### Widoczna orkiestracja agentów — to jest ważniejsze niż ładny UI

Realne ryzyko: jeśli cały pipeline (Job Parser → retrieval → Tailoring → ATS Reviewer → Cover Letter → Interview Prep) chowa się za jednym spinnerem "Generuję...", to dla kogoś oglądającego demo **nie widać w ogóle**, że tam jest jakakolwiek orkiestracja — a to ma być główny dowód umiejętności. Dlatego dwie zmiany:

1. **Zmiana decyzji: Mastra od początku, nie odłożona** (zaktualizowane w sekcji 1). Wcześniej odłożone, bo przepływ nie jest "grafowy" i technicznie niepotrzebne — ale Mastra daje wbudowany tracing/obserwowalność kroków agentowych, czyli dokładnie to narzędzie, którego potrzebujesz, żeby orkiestrację pokazać, nie tylko żeby działała. To uzasadniona zmiana wcześniejszej zasady "nie dokładaj zależności bez potrzeby" — potrzeba jest teraz jawnie zdefiniowana.
2. **Ekran "co się dzieje" jako realny element UI, nie tylko log w konsoli** — podczas generowania user widzi live: "1. Analizuję ofertę pracy... ✓ Senior Backend Engineer @ Firma X, kluczowe słowa: Python, Kubernetes" → "2. Dobieram najbardziej trafne doświadczenia... ✓ wybrano 4 z 12" → "3. Piszę CV dopasowane do oferty..." (tekst pojawia się na żywo, streaming z `generateObject`/Mastra) → "4. Sprawdzam zgodność z ATS... 87/100" → "5. Piszę list motywacyjny...". Realizacja bez nowej infrastruktury: tabela `generation_runs` (kolumna `steps` jako JSON: nazwa/status/skrót wyniku/czas), aktualizowana po każdym kroku agenta, UI odpytuje ją przez TanStack Query z `refetchInterval` w trakcie trwania generacji (kilkanaście sekund, nie trzeba websocketów/SSE). Ta sama tabela rozszerza `usage_log` z sekcji 21 — jeden mechanizm, dwa zastosowania (bezpieczeństwo finansowe + widoczność).
3. **Statyczny "Jak to działa" na stronie głównej** — diagram 5 agentów i ich ról, widoczny nawet dla kogoś, kto nie odpali live demo. Zero kosztu, czysto prezentacyjne.

To wszystko trafia też do case study z sekcji 24 — "obserwowalna orkiestracja, nie czarna skrzynka" to konkretna, nazwana decyzja inżynierska warta jednego akapitu.
