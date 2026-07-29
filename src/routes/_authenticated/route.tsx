import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { verificarAcessoAoPainel } from "@/lib/empresa";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Estar autenticado não basta: o login vale no projeto Supabase inteiro,
    // que é compartilhado entre os painéis. Aqui confirmamos que o usuário é
    // desta empresa. Fica no beforeLoad — e não só na tela de login — porque
    // uma sessão salva no navegador pula a tela de login inteira.
    const acesso = await verificarAcessoAoPainel();
    if (!acesso.permitido) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { erro: acesso.motivo } });
    }

    return { user: data.user, empresa: { slug: acesso.slug, nome: acesso.nome } };
  },
  component: LayoutComponent,
});

function LayoutComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
