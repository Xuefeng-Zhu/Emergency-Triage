import { createHash, randomBytes, randomUUID } from "node:crypto";
import { account, db, invitations, user } from "@emergency-trial/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashPassword } from "./password";

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createInvitation(input: {
  email: string;
  name: string;
  role: "user" | "admin";
  invitedById: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(invitations).values({
    tokenHash: hashInvitationToken(token),
    email: input.email,
    name: input.name,
    role: input.role,
    invitedById: input.invitedById,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
  });
  return token;
}

export async function getInvitation(token: string) {
  return db.query.invitations.findFirst({
    where: and(
      eq(invitations.tokenHash, hashInvitationToken(token)),
      isNull(invitations.usedAt),
      gt(invitations.expiresAt, new Date()),
    ),
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      expiresAt: true,
    },
  });
}

export async function acceptInvitation(
  token: string,
  password: string,
): Promise<void> {
  const tokenHash = hashInvitationToken(token);
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const invitation = await tx.query.invitations.findFirst({
      where: and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    });
    if (!invitation) throw new Error("Invitation is invalid or expired");

    const existing = await tx.query.user.findFirst({
      where: eq(user.email, invitation.email),
      columns: { id: true },
    });
    if (existing) throw new Error("An account already exists for this email");

    const userId = randomUUID();
    const now = new Date();
    await tx.insert(user).values({
      id: userId,
      name: invitation.name,
      email: invitation.email,
      emailVerified: true,
      role: invitation.role,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(invitations)
      .set({ usedAt: now })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.usedAt)));
  });
}
