import { auth, type AppSession } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function getSession(): Promise<AppSession | null> {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin(): Promise<AppSession> {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (role !== "admin") redirect("/workspace");
  return session;
}
