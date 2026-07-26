"use client";

import {
  acceptInvitationAction,
  type FormState,
} from "@/app/actions/auth-actions";
import { useActionState } from "react";

const initialState: FormState = { ok: false, message: "" };

export function EnrollForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    acceptInvitationAction,
    initialState,
  );
  return (
    <form className="auth-form" action={action}>
      <input name="token" type="hidden" value={token} />
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      <label>
        Confirm password
        <input
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>
      {state.message ? (
        <p className={state.ok ? "form-success" : "form-error"}>
          {state.message}
        </p>
      ) : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
