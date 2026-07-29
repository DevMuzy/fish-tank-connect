/**
 * Porta do painel: cada deploy atende UMA empresa e recusa login das outras.
 *
 * Por que isso é necessário: os painéis compartilham o mesmo projeto Supabase,
 * logo compartilham a mesma tabela `auth.users`. Não existe "usuário do painel
 * A" no Supabase — existe usuário do projeto. Sem esta checagem, a tela de
 * login de qualquer um dos painéis aceita a senha de qualquer cliente.
 *
 * Isto é controle de ACESSO, não de dados. A proteção dos dados continua sendo
 * a RLS (`empresa_id = empresa_do_usuario()`): mesmo que alguém contorne esta
 * verificação mexendo no navegador, o Postgres não devolve uma linha sequer da
 * outra empresa. As duas camadas fazem trabalhos diferentes e as duas precisam
 * existir — esta impede de entrar, a RLS impede de ler.
 */
import { supabase } from "@/integrations/supabase/client";

/** Slug da empresa que ESTE deploy atende. Vem do build (Vercel → env vars). */
export const EMPRESA_DO_PAINEL = import.meta.env.VITE_EMPRESA_SLUG as string | undefined;

export type ResultadoAcesso =
  | { permitido: true; slug: string; nome: string }
  | { permitido: false; motivo: string };

/**
 * Confere se o usuário logado pertence à empresa deste painel.
 *
 * Lê `empresas` direto: a policy "Ver a própria empresa" já limita o SELECT à
 * empresa do próprio usuário, então esta consulta devolve no máximo uma linha —
 * a dele. Não dá para sondar as outras por aqui.
 */
export async function verificarAcessoAoPainel(): Promise<ResultadoAcesso> {
  if (!EMPRESA_DO_PAINEL) {
    // Fail-closed: sem a variável configurada não dá para saber que painel é
    // este, e adivinhar seria justamente abrir a porta que queremos fechar.
    return {
      permitido: false,
      motivo: "Painel sem VITE_EMPRESA_SLUG configurado. Avise o suporte.",
    };
  }

  const { data, error } = await supabase.from("empresas").select("slug, nome").maybeSingle();

  if (error) return { permitido: false, motivo: "Não foi possível validar seu acesso." };
  if (!data) {
    return {
      permitido: false,
      motivo: "Seu usuário não está vinculado a nenhuma empresa. Avise o suporte.",
    };
  }

  if (data.slug !== EMPRESA_DO_PAINEL) {
    // Mensagem propositalmente sem dizer a qual painel ele pertence — quem
    // errou de endereço já sabe qual é o seu; quem está tentando descobrir, não.
    return { permitido: false, motivo: "Este acesso não pertence a este painel." };
  }

  return { permitido: true, slug: data.slug, nome: data.nome };
}
