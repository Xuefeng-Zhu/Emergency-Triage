import { getInvitation } from "@/lib/invitations";
import { notFound } from "next/navigation";
import { EnrollForm } from "./enroll-form";

export default async function EnrollPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getInvitation(token);
  if (!invitation) notFound();

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-lockup">Emergency Trial</div>
        <h1>Set up your account</h1>
        <p>
          Welcome, {invitation.name}. This enrollment link for{" "}
          <strong>{invitation.email}</strong> can be used once.
        </p>
        <EnrollForm token={token} />
      </section>
    </main>
  );
}
