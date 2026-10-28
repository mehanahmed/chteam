import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.connection_ai_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
      connection_id UUID NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      persona_name VARCHAR(255) NOT NULL DEFAULT 'Maya',
      persona_tone VARCHAR(50) NOT NULL DEFAULT 'friendly',
      store_name VARCHAR(255),
      custom_instructions TEXT,
      inside_dhaka_fee NUMERIC(10, 2) NOT NULL DEFAULT 80,
      sub_dhaka_fee NUMERIC(10, 2) NOT NULL DEFAULT 120,
      outside_dhaka_fee NUMERIC(10, 2) NOT NULL DEFAULT 150,
      outside_dhaka_advance_required BOOLEAN NOT NULL DEFAULT true,
      outside_dhaka_advance_amount NUMERIC(10, 2) NOT NULL DEFAULT 120,
      faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_connection_ai_settings UNIQUE (company_id, connection_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_connection_ai_settings_lookup
      ON public.connection_ai_settings (company_id, connection_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.connection_ai_settings CASCADE`.execute(db);
}
