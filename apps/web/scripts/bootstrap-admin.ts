import { randomBytes, randomUUID } from "node:crypto";
import { account, db, pool, user } from "@emergency-trial/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/password";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = argument("email")?.toLowerCase();
const name = argument("name");

if (!email || !name) {
  console.error(
    'Usage: pnpm bootstrap:admin -- --email admin@example.test --name "Local Admin"',
  );
  process.exitCode = 1;
} else {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  });
  if (existing) {
    console.error("An account already exists for that email.");
    process.exitCode = 1;
  } else {
    const initialPassword = randomBytes(18).toString("base64url");
    const password = await hashPassword(initialPassword);
    const userId = randomUUID();
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        email,
        name,
        emailVerified: true,
        role: "admin",
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password,
        createdAt: now,
        updatedAt: now,
      });
    });
    console.log(`Administrator created for ${email}`);
    console.log(`Initial password: ${initialPassword}`);
    console.log("Store it securely. This value will not be shown again.");
  }
}

await pool.end();
