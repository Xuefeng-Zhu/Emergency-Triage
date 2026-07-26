import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/workspace");
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-lockup">Emergency Trial</div>
        <h1>Sign in to your workspace</h1>
        <p>Private voice sessions, transcripts, and local agent analysis.</p>
        <LoginForm />
      </section>
    </main>
  );
}
