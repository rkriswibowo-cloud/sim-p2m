"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function LoginForm({ renew }: { renew: boolean }) {
  const [pending, setPending] = useState(renew);
  const [error, setError] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (!renew || attempted.current) return;
    attempted.current = true;
    async function refresh() {
      try {
        const response = await fetch("/api/v1/auth/refresh", { method: "POST" });
        if (response.ok) {
          window.location.replace("/simp2m");
          return;
        }
      } catch {
        // The login form remains available after a failed refresh.
      }
      setError("Sesi tidak bisa diperbarui. Silakan masuk kembali.");
      setPending(false);
    }
    void refresh();
  }, [renew]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      });
      if (response.ok) {
        window.location.replace("/simp2m");
        return;
      }
      switch (response.status) {
        case 401:
          setError("Email atau kata sandi salah.");
          break;
        case 429:
          setError("Terlalu banyak percobaan masuk. Coba lagi dalam satu menit.");
          break;
        default:
          setError("Layanan masuk tidak dapat digunakan saat ini.");
      }
    } catch {
      setError("Koneksi ke layanan masuk terputus.");
    }
    setPending(false);
  }

  return (
    <Card lang="id" className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <GraduationCap aria-hidden="true" className="size-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Masuk ke SIM-P2M</h1>
          <p className="text-sm text-muted-foreground">Universitas Anwar Medika</p>
        </div>
      </CardHeader>
      <CardContent>
        <form method="post" className="space-y-4" onSubmit={login}>
          <Input label="Email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={pending} />
          <Input label="Kata sandi" name="password" type="password" autoComplete="current-password" maxLength={256} required disabled={pending} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Memproses…" : "Masuk"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
