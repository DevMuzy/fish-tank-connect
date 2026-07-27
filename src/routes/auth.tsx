import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import logoFull from "@/assets/logo-full.jpg";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Vitória Mar Pescados" },
      { name: "description", content: "Acesse o painel de gestão da sua peixaria." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo!");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-sidebar text-sidebar-foreground relative overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <img src={logoFull} alt="Vitória Mar Pescados" className="h-20 w-20 rounded-2xl object-cover shadow-elevated" />
          <div>
            <div className="font-bold text-lg tracking-tight">Vitória Mar Pescados</div>
            <div className="text-xs text-sidebar-foreground/60">Gestão & Relacionamento</div>
          </div>
        </div>
        <div className="relative z-10 space-y-5">
          <h1 className="text-4xl font-bold leading-tight">
            Sua base de clientes,<br />
            <span className="text-sidebar-primary">sempre à mão.</span>
          </h1>
          <p className="text-sidebar-foreground/70 max-w-md">
            Cadastre em segundos, envie campanhas de WhatsApp e nunca mais esqueça um
            aniversário de cliente.
          </p>
          <ul className="space-y-2 text-sm text-sidebar-foreground/80">
            <li>• Cadastro ultrarrápido no caixa</li>
            <li>• Disparos de WhatsApp com assistente de IA</li>
            <li>• Aniversariantes organizados automaticamente</li>
          </ul>
        </div>
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(1200px 500px at 20% 90%, oklch(0.74 0.13 229 / 0.35), transparent 60%), radial-gradient(800px 400px at 90% 10%, oklch(0.354 0.12 278 / 0.4), transparent 60%)",
          }}
        />
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden flex items-center gap-3">
            <img src={logoFull} alt="Vitória Mar Pescados" className="h-12 w-12 rounded-xl object-cover" />
            <div className="font-bold text-lg">Vitória Mar Pescados</div>
          </div>

          <div>
            <h2 className="text-2xl font-bold">Acessar painel</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Entre com seu e-mail e senha para gerenciar seus clientes.
            </p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-in">E-mail</Label>
              <Input id="email-in" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-in">Senha</Label>
              <Input id="pw-in" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
