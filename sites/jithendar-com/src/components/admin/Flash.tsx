import { Alert } from "@/components/ui/form";

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="mb-6"><Alert>{error}</Alert></div>;
  if (ok) return <div className="mb-6"><Alert tone="success">{ok}</Alert></div>;
  return null;
}

export type FlashParams = Promise<{ ok?: string; error?: string; [k: string]: string | undefined }>;
