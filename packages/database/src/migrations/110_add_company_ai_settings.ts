import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.company_ai_settings (
      company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
      is_muted BOOLEAN NOT NULL DEFAULT false,
      gemini_api_key TEXT,
      primary_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.0-flash',
      fallback_model VARCHAR(100) NOT NULL DEFAULT 'gemini-1.5-flash',
      updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    UPDATE public.company_ai_settings
    SET primary_model = 'gemini-2.0-flash'
    WHERE primary_model LIKE 'gemini-2.5%' OR primary_model LIKE 'gemini-3.5%'
  `.execute(db);

  await sql`
    UPDATE public.company_ai_settings
    SET fallback_model = 'gemini-1.5-flash'
    WHERE fallback_model LIKE 'gemini-2.5%' OR fallback_model LIKE 'gemini-3.5%'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.company_ai_settings CASCADE`.execute(db);
}
