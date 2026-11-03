import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.company_ai_settings (
      company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
      is_muted BOOLEAN NOT NULL DEFAULT false,
      gemini_api_key TEXT,
      primary_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
      fallback_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash-lite',
      updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.company_ai_settings CASCADE`.execute(db);
}
