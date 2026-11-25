"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function logout() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (response.ok) {
        window.location.replace("/login");
        return;
      }
    } catch {
      // Report the failed logout so the user can retry.
    }
    setError(true);
    setPending(false);
  }

  return (
    <div className="text-right">
      <Button variant="outline" onClick={logout} disabled={pending}>
        {pending ? "Memproses…" : "Keluar"}
      </Button>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">Gagal keluar. Coba lagi.</p>}
    </div>
  );
}
