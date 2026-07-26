import { notFound } from "next/navigation";
import { WorkspaceShell } from "../workspace-shell";

export default function PreviewPage() {
  if (process.env.PREVIEW_ENABLED === "false") notFound();
  return (
    <WorkspaceShell
      preview
      user={{
        id: "preview-user",
        name: "Alex Morgan",
        email: "alex@example.test",
        role: "admin",
      }}
      initialRecording={null}
    />
  );
}
