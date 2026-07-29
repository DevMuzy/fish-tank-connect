/**
 * Portão do painel no SERVIDOR.
 *
 * O banco Supabase é único para todos os clientes, logo `auth.users` é único:
 * uma senha válida é válida em todos os painéis. A checagem que existe no
 * navegador (`src/lib/empresa.ts`) resolve a experiência, mas qualquer pessoa
 * consegue chamar um endpoint direto, sem passar pela tela. Este middleware é
 * quem de fato recusa: server function chamada com token de outra empresa não
 * executa.
 *
 * Arquivo separado do `auth-middleware.ts` de propósito — aquele é gerado
 * automaticamente e seria sobrescrito.
 *
 * Camadas, do mais fraco ao mais forte:
 *   1. tela        — mensagem clara para quem errou o endereço
 *   2. middleware  — este; recusa a chamada mesmo sem passar pela tela
 *   3. RLS         — última linha; o Postgres não devolve linha de outra empresa
 */
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireAuthDaEmpresa = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const esperado = process.env.EMPRESA_SLUG;
    if (!esperado) {
      // Falha fechada: sem saber que painel é este, liberar seria justamente
      // abrir a porta que este arquivo existe para fechar.
      throw new Error("Servidor sem EMPRESA_SLUG configurado.");
    }

    // A policy "Ver a própria empresa" limita o SELECT à empresa do próprio
    // usuário, então isto devolve no máximo uma linha — a dele.
    const { data, error } = await context.supabase
      .from("empresas")
      .select("id, slug")
      .maybeSingle();

    if (error) throw new Error("Não foi possível validar a empresa do usuário.");
    if (!data) throw new Error("Unauthorized: usuário sem empresa vinculada.");
    if (data.slug !== esperado) {
      throw new Error("Unauthorized: este acesso não pertence a este painel.");
    }

    return next({ context: { empresaId: data.id as string, empresaSlug: data.slug as string } });
  });
