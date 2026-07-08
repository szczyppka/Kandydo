import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL nie jest ustawione (sprawdź .env)");
}

const client = postgres(process.env.DATABASE_URL);

export const db = drizzle(client, { schema });
