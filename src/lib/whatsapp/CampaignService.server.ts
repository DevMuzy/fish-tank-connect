/**
 * CampaignService — orquestra o disparo de uma campanha.
 * Desenhado em dois passos granulares (em vez de um loop único e longo)
 * porque a Vercel mata funções serverless de longa duração: com delay de
 * vários segundos entre mensagens, uma campanha para 100+ contatos passaria
 * muito do limite de execução. Quem conduz o loop e o delay é o cliente
 * (mensagens.tsx), chamando `enviarUm` uma vez por destinatário — o que
 * também é o que permite mostrar progresso ao vivo na tela.
 *
 *   1. iniciar()  → resolve destinatários, remove quem já recebeu esse texto,
 *                    cria `mensagens` e enfileira `historico_envios`
 *                    (status = aguardando)
 *   2. enviarUm()  → chamado uma vez por item da fila; reserva a linha antes
 *                    de enviar, então cada destinatário recebe no máximo uma vez
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppService, carregarIntegracaoAtiva } from "./WhatsAppService.server";
import { normalizeTelefone } from "./providers.server";
import { DELAY_ENTRE_ENVIOS_MS } from "./config";
import { fazAniversarioHoje } from "@/lib/datas";

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

// Sem retry automático, de propósito: quando o envio falha *depois* que a
// Evolution já entregou (timeout, queda de conexão na volta), repetir manda
// a mesma mensagem duas vezes pro mesmo contato. Falha vira registro de
// falha no histórico e o operador reenvia individualmente se quiser.
const MAX_TENTATIVAS = 1;

// Garante um envio por pessoa mesmo que a consulta traga a mesma pessoa mais
// de uma vez. Deduplica também por telefone normalizado: `clientes.telefone`
// é UNIQUE como texto, então "27999255959" e "(27) 99925-5959" convivem como
// cadastros distintos — mas são o mesmo WhatsApp.
function deduplicarPorCliente(lista: Destinatario[]): Destinatario[] {
  const idsVistos = new Set<string>();
  const telefonesVistos = new Set<string>();
  return lista.filter((c) => {
    const tel = normalizeTelefone(c.telefone);
    if (idsVistos.has(c.id) || telefonesVistos.has(tel)) return false;
    idsVistos.add(c.id);
    telefonesVistos.add(tel);
    return true;
  });
}

/**
 * Clientes que já receberam *este mesmo texto* em qualquer campanha anterior.
 * É o que impede o mesmo cliente de receber a mesma mensagem duas vezes,
 * mesmo que o operador dispare a campanha de novo por engano.
 *
 * Só conta envio que de fato saiu (ou está saindo). Quem falhou continua
 * elegível — senão um erro de rede deixaria o cliente sem receber pra sempre.
 */
async function clientesQueJaReceberam(
  supabase: SupabaseClient,
  mensagem: string,
): Promise<Set<string>> {
  const { data: campanhas, error: campErr } = await supabase
    .from("mensagens")
    .select("id")
    .eq("mensagem", mensagem);
  if (campErr) throw campErr;

  const ids = (campanhas ?? []).map((m) => m.id as string);
  if (ids.length === 0) return new Set();

  const { data: envios, error } = await supabase
    .from("historico_envios")
    .select("cliente_id")
    .in("mensagem_id", ids)
    .in("status", ["enviado", "simulado", "enviando"]);
  if (error) throw error;

  return new Set(
    (envios ?? []).map((e) => e.cliente_id as string | null).filter((id): id is string => !!id),
  );
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
    // Comparação no fuso da loja, não em UTC: o servidor da Vercel roda em
    // UTC e das 21h à meia-noite no Brasil lá já é o dia seguinte — um
    // disparo noturno pegaria os aniversariantes de amanhã.
    return lista.filter((c) => fazAniversarioHoje(c.data_nascimento));
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
  delayMs: number;
  /** Quantos foram removidos da fila por já terem recebido esse mesmo texto. */
  jaReceberam: number;
};

export type EnvioUnicoResultado = {
  ok: boolean;
  erro?: string;
  /** true quando a fila já havia sido processada e o envio foi ignorado. */
  duplicado?: boolean;
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
    const candidatos = await resolverDestinatarios(this.supabase, input);
    if (candidatos.length === 0) {
      throw new Error("Nenhum destinatário encontrado para os critérios selecionados.");
    }

    const jaReceberamIds = await clientesQueJaReceberam(this.supabase, input.mensagem);
    const destinatarios = candidatos.filter((d) => !jaReceberamIds.has(d.id));
    const jaReceberam = candidatos.length - destinatarios.length;

    if (destinatarios.length === 0) {
      throw new Error(
        candidatos.length === 1
          ? "Esse cliente já recebeu essa mensagem. Nada foi enviado."
          : `Todos os ${candidatos.length} destinatários já receberam essa mensagem. Nada foi enviado.`,
      );
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

    return { mensagemId, fila, delayMs: await this.delayDaEmpresa(), jaReceberam };
  }

  /**
   * Delay entre envios, lido do banco. A RLS de `empresas` só devolve a linha
   * da própria empresa, então não há como pegar o valor de outra.
   * Cai no default de código apenas se a linha sumir — nunca abaixo de 12s.
   */
  private async delayDaEmpresa(): Promise<number> {
    const { data } = await this.supabase.from("empresas").select("delay_envio_ms").maybeSingle();
    return Math.max(data?.delay_envio_ms ?? DELAY_ENTRE_ENVIOS_MS, DELAY_ENTRE_ENVIOS_MS);
  }

  /**
   * Envia para UM item da fila.
   *
   * Recebe só o id da linha — telefone, texto e imagem saem do banco, nunca do
   * que o navegador mandou. Antes eles vinham por parâmetro, e isso deixava o
   * número discado à mercê do estado da tela: duas abas abertas, um retry, uma
   * corrida entre campanhas e o item da fila de um cliente podia ser pareado
   * com o telefone de outro. Lendo da linha reservada — que a RLS já restringe
   * à empresa do usuário — não existe caminho para uma campanha discar um
   * número que não esteja na fila da própria empresa.
   */
  async enviarUm(historicoId: string): Promise<EnvioUnicoResultado> {
    // Claim atômico: só segue quem conseguir tirar a linha de "aguardando".
    // Um UPDATE ... WHERE status = 'aguardando' é atômico no Postgres, então
    // duas chamadas concorrentes pro mesmo historicoId (duplo clique, retry do
    // navegador, aba reaberta) — só uma envia. As outras saem aqui.
    const { data: reservado, error: claimErr } = await this.supabase
      .from("historico_envios")
      .update({ status: "enviando" })
      .eq("id", historicoId)
      .eq("status", "aguardando")
      .select("id, telefone, mensagem_id");
    if (claimErr) throw claimErr;

    if (!reservado || reservado.length === 0) {
      return { ok: true, duplicado: true };
    }

    const linha = reservado[0];
    const telefone = linha.telefone as string;

    // Texto e imagem vêm da campanha à qual esta linha pertence. Também sob
    // RLS: campanha de outra empresa não é legível daqui.
    const { data: campanha, error: campErr } = await this.supabase
      .from("mensagens")
      .select("mensagem, imagem_url")
      .eq("id", linha.mensagem_id as string)
      .single();

    if (campErr || !campanha) {
      await this.supabase
        .from("historico_envios")
        .update({ status: "falhou", ultimo_erro: "Campanha não encontrada." })
        .eq("id", historicoId);
      return { ok: false, erro: "Campanha não encontrada." };
    }

    const mensagem = campanha.mensagem as string;
    const imagemUrl = campanha.imagem_url as string | null;

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
      } catch (e) {
        ultimoErro = (e as Error).message;
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
