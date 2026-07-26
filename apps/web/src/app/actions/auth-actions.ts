"use server";

import {
  acceptInvitationSchema,
  createInvitationSchema,
} from "@emergency-trial/contracts";
import { redirect } from "next/navigation";
import { createInvitation, acceptInvitation } from "@/lib/invitations";
import { requireAdmin } from "@/lib/session";

export interface FormState {
  ok: boolean;
  message: string;
  url?: string;
}

export async function acceptInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acceptInvitationSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid invitation",
    };
  }
  try {
    await acceptInvitation(parsed.data.token, parsed.data.password);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Enrollment failed",
    };
  }
  redirect("/login?enrolled=1");
}

export async function createInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireAdmin();
  const parsed = createInvitationSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid invitation",
    };
  }
  const token = await createInvitation({
    ...parsed.data,
    invitedById: session.user.id,
  });
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return {
    ok: true,
    message: "Enrollment link created. It expires in 24 hours.",
    url: `${origin}/enroll/${token}`,
  };
}
