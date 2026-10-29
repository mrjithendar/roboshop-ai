import { redirect } from "next/navigation";

// Settings moved into Admin → Appearance & Site Settings (draft, preview, publish, history).
export default function SettingsPage() {
  redirect("/admin/appearance?section=general");
}
