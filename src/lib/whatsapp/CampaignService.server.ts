/**
 * CampaignService — orquestra o disparo de uma campanha.
 * Desenhado em dois passos granulares (em vez de um loop único e longo)
 * porque a Vercel mata funções serverless de longa duração: com delay de
 * vários segundos entre mensagens, uma campanha para 100+ contatos passaria
 * muito do limite de execução. Quem conduz o loop e o delay é o cliente
 * (mensagens.tsx), chamando `enviarUm` uma vez por destinatário — o que
 * também é o que permite mostrar progresso ao vivo na tela.
 *
 *   1. iniciar()  → resolve destinatários, cria `mensagens` e enfileira
 *                    `historico_envios` (status = aguardando)
 *   2. enviarUm()  → chamado uma vez por item da fila, com retry e backoff
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
// Delay entre cada envio quando o total > LIMITE_DISPAROS_SEM_DELAY.
// Faixa (min–max) em vez de valor fixo, pra não gerar um intervalo robótico.
const DELAY_ENTRE_ENVIOS_MIN_MS = 7000;
const DELAY_ENTRE_ENVIOS_MAX_MS = 10000;
const MAX_TENTATIVAS = 2;

// Garante um envio por cliente mesmo que a consulta traga a mesma pessoa
// mais de uma vez (defesa extra — nunca dois disparos pro mesmo destinatário).
function deduplicarPorCliente(lista: Destinatario[]): Destinatario[] {
  const vistos = new Set<string>();
  return lista.filter((c) => {
    if (vistos.has(c.id)) return false;
    vistos.add(c.id);
    return true;
  });
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
  const lista = deduplicarPorCliente((todos ?? []) as Destinatario[]);

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

export type FilaItem = {
  historicoId: string;
  clienteId: string;
  nome: string;
  telefone: string;
};

export type IniciarResultado = {
  mensagemId: string;
  fila: FilaItem[];
  aplicarDelay: boolean;
  delayMinMs: number;
  delayMaxMs: number;
};

export type EnvioUnicoResultado = {
  ok: boolean;
  erro?: string;
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

  get providerName() {
    return this.whatsapp.providerName;
  }

  async iniciar(input: DisparoInput): Promise<IniciarResultado> {
    const destinatarios = await resolverDestinatarios(this.supabase, input);
    if (destinatarios.length === 0) {
      throw new Error("Nenhum destinatário encontrado para os critérios selecionados.");
    }

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

    const nomesPorCliente = new Map(destinatarios.map((d) => [d.id, d.nome]));
    const fila: FilaItem[] = (filaRows ?? []).map((r) => ({
      historicoId: r.id as string,
      clienteId: r.cliente_id as string,
      telefone: r.telefone as string,
      nome: nomesPorCliente.get(r.cliente_id as string) ?? "Cliente",
    }));

    return {
      mensagemId,
      fila,
      aplicarDelay: destinatarios.length > LIMITE_DISPAROS_SEM_DELAY,
      delayMinMs: DELAY_ENTRE_ENVIOS_MIN_MS,
      delayMaxMs: DELAY_ENTRE_ENVIOS_MAX_MS,
    };
  }

  async enviarUm(
    historicoId: string,
    telefone: string,
    mensagem: string,
    imagemUrl?: string | null,
  ): Promise<EnvioUnicoResultado> {
    await this.supabase
      .from("historico_envios")
      .update({ status: "enviando" })
      .eq("id", historicoId);

    let tentativa = 0;
    let ok = false;
    let ultimoErro: string | undefined;
    let ultimaResposta: Record<string, unknown> | undefined;

    while (tentativa < MAX_TENTATIVAS && !ok) {
      tentativa++;
      try {
        const r = await this.whatsapp.enviar(telefone, mensagem, imagemUrl);
        ok = r.ok;
        ultimaResposta = r.response;
        ultimoErro = r.error;
        if (ok) break;
      } catch (e) {
        ultimoErro = (e as Error).message;
      }
      if (!ok && tentativa < MAX_TENTATIVAS) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    await this.supabase
      .from("historico_envios")
      .update({
        status: ok ? "enviado" : "falhou",
        tentativas: tentativa,
        ultimo_erro: ok ? null : ultimoErro ?? "Erro desconhecido",
        resposta_api: ultimaResposta ?? (ultimoErro ? { error: ultimoErro } : null),
      })
      .eq("id", historicoId);

    return { ok, erro: ok ? undefined : ultimoErro ?? "Erro desconhecido" };
  }
}
