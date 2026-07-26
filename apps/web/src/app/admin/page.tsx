import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import { InviteForm } from "./invite-form";

export default async function AdminPage() {
  await requireAdmin();
  return (
    <main className="admin-page">
      <header className="simple-header">
        <Link href="/workspace" className="brand-lockup">
          Emergency Trial
        </Link>
        <Link href="/workspace">Back to workspace</Link>
      </header>
      <section className="admin-content">
        <h1>Invite a teammate</h1>
        <p>
          Enrollment links expire after 24 hours and are shown only in this
          browser response. Send the link through a trusted channel.
        </p>
        <InviteForm />
      </section>
    </main>
  );
}
