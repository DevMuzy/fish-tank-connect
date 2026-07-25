/**
 * CampaignService — orquestra o disparo de uma campanha inteira.
 * Fluxo:
 *   1. Resolve destinatários conforme tipo_envio (todos | individual | aniversariantes)
 *   2. Cria registro em `mensagens` (status = processando)
 *   3. Enfileira registros em `historico_envios` (status = aguardando)
 *   4. Processa fila sequencialmente com controle de taxa (rate limit)
 *   5. Atualiza status de cada envio (enviando → enviado/falhou) com tentativas e erro
 *   6. Consolida contagem em `mensagens` (sucesso, erros, status final)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppService, carregarIntegracaoAtiva } from "./WhatsAppService.server";

export type TipoEnvio = "todos" | "individual" | "aniversariantes";

export type DisparoInput = {
  mensagem: string;
  tipo_envio: TipoEnvio;
  cliente_id?: string | null;
  imagem_url?: string | null;
};

type Destinatario = {
  id: string;
  nome: string;
  telefone: string;
  data_nascimento: string;
};

// Acima desse total de destinatários, passa a espaçar os envios — evita
// que o número seja banido por comportamento de spam em disparos em massa.
const LIMITE_DISPAROS_SEM_DELAY = 5;
// Delay aplicado entre cada envio quando o total > LIMITE_DISPAROS_SEM_DELAY.
// Faixa (min–max) em vez de valor fixo, pra não gerar um intervalo robótico.
const DELAY_ENTRE_ENVIOS_MIN_MS = 3000;
const DELAY_ENTRE_ENVIOS_MAX_MS = 7000;
const MAX_TENTATIVAS = 2;

function delayAleatorio(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

async function resolverDestinatarios(
  supabase: SupabaseClient,
  input: DisparoInput,
): Promise<Destinatario[]> {
  if (input.tipo_envio === "individual") {
    if (!input.cliente_id) throw new Error("cliente_id é obrigatório para envio individual.");
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nome, telefone, data_nascimento")
      .eq("id", input.cliente_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Cliente não encontrado.");
    return [data as Destinatario];
  }

  const { data: todos, error } = await supabase
    .from("clientes")
    .select("id, nome, telefone, data_nascimento");
  if (error) throw error;
  const lista = (todos ?? []) as Destinatario[];

  if (input.tipo_envio === "aniversariantes") {
    const hoje = new Date();
    const mm = hoje.getUTCMonth() + 1;
    const dd = hoje.getUTCDate();
    return lista.filter((c) => {
      const d = new Date(c.data_nascimento);
      return d.getUTCMonth() + 1 === mm && d.getUTCDate() === dd;
    });
  }
  return lista;
}

export type ResumoCampanha = {
  mensagem_id: string;
  total: number;
  sucesso: number;
  falha: number;
  provider: string;
};

export class CampaignService {
  constructor(
    private supabase: SupabaseClient,
    private whatsapp: WhatsAppService,
    private userId: string,
  ) {}

  static async create(supabase: SupabaseClient, userId: string) {
    const integracao = await carregarIntegracaoAtiva(supabase);
    return new CampaignService(supabase, new WhatsAppService(integracao), userId);
  }

  async executar(input: DisparoInput): Promise<ResumoCampanha> {
    const destinatarios = await resolverDestinatarios(this.supabase, input);
    if (destinatarios.length === 0) {
      throw new Error("Nenhum destinatário encontrado para os critérios selecionados.");
    }

    // 1. Cria a campanha
    const { data: msg, error: msgErr } = await this.supabase
      .from("mensagens")
      .insert({
        mensagem: input.mensagem,
        tipo_envio: input.tipo_envio,
        cliente_id: input.tipo_envio === "individual" ? destinatarios[0].id : null,
        imagem_url: input.imagem_url ?? null,
        quantidade_destinatarios: destinatarios.length,
        status: "processando",
        created_by: this.userId,
      })
      .select("id")
      .single();
    if (msgErr) throw msgErr;
    const mensagemId = msg.id as string;

    // 2. Enfileira todos os envios (fila persistente no banco)
    const filaInsert = destinatarios.map((d) => ({
      mensagem_id: mensagemId,
      cliente_id: d.id,
      telefone: d.telefone,
      status: "aguardando",
    }));
    const { data: filaRows, error: filaErr } = await this.supabase
      .from("historico_envios")
      .insert(filaInsert)
      .select("id, cliente_id, telefone");
    if (filaErr) throw filaErr;

    // 3. Processa fila
    let sucesso = 0;
    let falha = 0;
    const fila = filaRows ?? [];
    const aplicarDelay = destinatarios.length > LIMITE_DISPAROS_SEM_DELAY;

    for (let i = 0; i < fila.length; i++) {
      const item = fila[i];
      await this.supabase
        .from("historico_envios")
        .update({ status: "enviando" })
        .eq("id", item.id);

      let tentativa = 0;
      let ok = false;
      let ultimoErro: string | undefined;
      let ultimaResposta: Record<string, unknown> | undefined;

      while (tentativa < MAX_TENTATIVAS && !ok) {
        tentativa++;
        try {
          const r = await this.whatsapp.enviar(item.telefone, input.mensagem, input.imagem_url);
          ok = r.ok;
          ultimaResposta = r.response;
          ultimoErro = r.error;
          if (ok) break;
        } catch (e) {
          ultimoErro = (e as Error).message;
        }
        // pequeno backoff antes de tentar novamente
        if (!ok && tentativa < MAX_TENTATIVAS) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      const statusFinal = ok ? "enviado" : "falhou";
      if (ok) sucesso++;
      else falha++;

      await this.supabase
        .from("historico_envios")
        .update({
          status: statusFinal,
          tentativas: tentativa,
          ultimo_erro: ok ? null : ultimoErro ?? "Erro desconhecido",
          resposta_api: ultimaResposta ?? (ultimoErro ? { error: ultimoErro } : null),
        })
        .eq("id", item.id);

      // rate-limit entre envios, só quando o disparo é em massa (>5) e ainda há próximo item
      if (aplicarDelay && i < fila.length - 1) {
        await delayAleatorio(DELAY_ENTRE_ENVIOS_MIN_MS, DELAY_ENTRE_ENVIOS_MAX_MS);
      }
    }

    // 4. Consolida na campanha
    const statusCampanha =
      falha === 0 ? "concluido" : sucesso === 0 ? "falhou" : "parcial";
    await this.supabase
      .from("mensagens")
      .update({ status: statusCampanha, sucesso, erros: falha })
      .eq("id", mensagemId);

    return {
      mensagem_id: mensagemId,
      total: destinatarios.length,
      sucesso,
      falha,
      provider: this.whatsapp.providerName,
    };
  }
}
