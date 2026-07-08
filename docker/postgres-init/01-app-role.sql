-- POSTGRES_USER (bootstrap Docker) jest zawsze superuserem — Postgres pomija RLS
-- dla superuserów niezależnie od FORCE ROW LEVEL SECURITY. Aplikacja musi łączyć się
-- rolą bez SUPERUSER/BYPASSRLS, inaczej RLS z src/lib/db/schema.ts jest fikcją.
-- To też wierniej odwzorowuje produkcję (Neon nie daje roli superusera).
CREATE ROLE kandydo_app WITH LOGIN PASSWORD 'kandydo_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- Właściciel bazy, nie tylko schematu `public` — drizzle-kit tworzy własny
-- schemat `drizzle` do trackingu migracji, co wymaga CREATE na poziomie bazy.
ALTER DATABASE kandydo OWNER TO kandydo_app;
GRANT ALL ON SCHEMA public TO kandydo_app;
ALTER SCHEMA public OWNER TO kandydo_app;
