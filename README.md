# Kandydo

CV/cover letter tailoring app. Zob. [`CLAUDE.md`](./CLAUDE.md) (konwencje repo) i [`docs/architecture.md`](./docs/architecture.md) (pełna architektura).

## Start lokalny

```bash
cp .env.example .env   # uzupełnij wartości lokalne (Docker) i sekrety
docker compose up -d   # Postgres + pgvector, MinIO
pnpm install
pnpm dev
```

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

Licencja: AGPL-3.0.
