import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { hashPassword } from "../lib/password.js";
import { createCompany } from "../services/company/core.js";
import { shutdownTenantConnections } from "../services/tenant.service.js";

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@omniteam.com").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "AdminPassword123!";
  const name = process.env.ADMIN_NAME || "Super Admin";
  const companyName = process.env.COMPANY_NAME || "CHTeam";

  console.log(`Checking existing account for ${email}...`);

  let user = await db
    .selectFrom("users")
    .where("email", "=", email)
    .selectAll()
    .executeTakeFirst();

  if (!user) {
    const passwordHash = await hashPassword(password);
    const now = new Date();
    user = await db
      .insertInto("users")
      .values({
        email,
        password_hash: passwordHash,
        name,
        email_verified_at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    console.log(`Created admin user with ID: ${user.id}`);
  } else {
    console.log(`Admin user already exists with ID: ${user.id}. Updating password and verification status...`);
    const passwordHash = await hashPassword(password);
    const now = new Date();
    user = await db
      .updateTable("users")
      .set({
        password_hash: passwordHash,
        email_verified_at: user.email_verified_at ?? now,
        updated_at: now,
      })
      .where("id", "=", user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    console.log(`Updated admin user: ${user.email}`);
  }

  // Check if company exists for this user
  const existingMembership = await db
    .selectFrom("company_members")
    .where("user_id", "=", user.id)
    .select(["company_id", "role"])
    .executeTakeFirst();

  let targetCompanyId: string;
  if (!existingMembership) {
    console.log(`Creating initial company "${companyName}"...`);
    const company = await createCompany(
      {
        name: companyName,
        description: "Primary workspace",
      },
      user.id
    );
    targetCompanyId = company.id;
    console.log(`Created workspace "${company.name}" (ID: ${company.id}, schema: ${company.schema_name})`);
  } else {
    targetCompanyId = existingMembership.company_id;
    console.log(`User already has membership in company ID: ${existingMembership.company_id} (${existingMembership.role})`);
  }

  // Ensure workspace has channel spine flags initialized
  const existingFlags = await db
    .selectFrom("channel_spine_workspace_flags")
    .select("revision")
    .where("company_id", "=", targetCompanyId)
    .executeTakeFirst();

  const stamp = `seed-admin:${new Date().toISOString()}`;
  const providers = ["telegram_bot"];
  if (existingFlags) {
    await db
      .updateTable("channel_spine_workspace_flags")
      .set({
        dual_write_enabled: true,
        dual_write_revision: stamp,
        shadow_normalization_enabled: true,
        shadow_normalization_revision: stamp,
        neutral_reads_enabled: true,
        neutral_read_revision: stamp,
        write_authority: "neutral",
        write_authority_revision: stamp,
        enabled_providers: sql<string[]>`${providers}::text[]`,
        provider_enable_revision: stamp,
        revision: String(Number(existingFlags.revision) + 1),
        updated_by: user.id,
      })
      .where("company_id", "=", targetCompanyId)
      .execute();
    console.log(`Updated channel spine workspace flags for company ID: ${targetCompanyId}`);
  } else {
    await db
      .insertInto("channel_spine_workspace_flags")
      .values({
        company_id: targetCompanyId,
        dual_write_enabled: true,
        dual_write_revision: stamp,
        shadow_normalization_enabled: true,
        shadow_normalization_revision: stamp,
        neutral_reads_enabled: true,
        neutral_read_revision: stamp,
        write_authority: "neutral",
        write_authority_revision: stamp,
        enabled_providers: sql<string[]>`${providers}::text[]`,
        provider_enable_revision: stamp,
        revision: "1",
        created_by: user.id,
        updated_by: user.id,
      })
      .execute();
    console.log(`Initialized channel spine workspace flags for company ID: ${targetCompanyId}`);
  }

  console.log("\n===========================================");
  console.log("Admin Account Ready!");
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log("===========================================\n");
}

try {
  await main();
} catch (error) {
  console.error("Error seeding admin:", error);
  process.exit(1);
} finally {
  await shutdownTenantConnections();
  await db.destroy();
  process.exit(0);
}
