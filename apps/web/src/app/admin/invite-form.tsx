"use client";

import {
  createInvitationAction,
  type FormState,
} from "@/app/actions/auth-actions";
import { useActionState } from "react";

const initialState: FormState = { ok: false, message: "" };

export function InviteForm() {
  const [state, action, pending] = useActionState(
    createInvitationAction,
    initialState,
  );
  return (
    <form className="auth-form invite-form" action={action}>
      <label>
        Name
        <input name="name" required maxLength={100} />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Role
        <select name="role" defaultValue="user">
          <option value="user">User</option>
          <option value="admin">Administrator</option>
        </select>
      </label>
      {state.message ? (
        <p className={state.ok ? "form-success" : "form-error"}>
          {state.message}
        </p>
      ) : null}
      {state.url ? (
        <output className="invite-output">
          <span>One-time enrollment URL</span>
          <code>{state.url}</code>
        </output>
      ) : null}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create enrollment link"}
      </button>
    </form>
  );
}
