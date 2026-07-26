"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(data.get("email")),
      password: String(data.get("password")),
      rememberMe: true,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed");
      return;
    }
    router.replace("/workspace");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          required
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
