/**
 * WhatsAppService — fachada única para envio.
 * Carrega dinamicamente a integração ativa no banco e delega ao provedor.
 * Regras de negócio (CampaignService/MessageService) nunca conhecem o provedor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnvioResultado, IntegracaoAtiva, WhatsAppProvider } from "./types";
import { resolveProvider } from "./providers.server";

export class WhatsAppService {
  private provider: WhatsAppProvider;
  constructor(public readonly integracao: IntegracaoAtiva) {
    this.provider = resolveProvider(integracao);
  }

  get providerName() {
    return this.provider.name;
  }

  async enviar(telefone: string, mensagem: string, imagemUrl?: string | null): Promise<EnvioResultado> {
    return this.provider.send({ telefone, mensagem, imagemUrl });
  }

  async healthCheck() {
    if (!this.provider.healthCheck) return { ok: true, detail: "sem verificação" };
    return this.provider.healthCheck();
  }

  async getQrCode() {
    if (!this.provider.getQrCode) {
      return { ok: false, error: "Esse provedor não usa pareamento por QR Code." };
    }
    return this.provider.getQrCode();
  }
}

export async function carregarIntegracaoAtiva(
  supabase: SupabaseClient,
): Promise<IntegracaoAtiva> {
  const { data, error } = await supabase
    .from("integracoes_whatsapp")
    .select("id, nome, provedor, url_base, token, numero_remetente, ativo, status_conexao")
    .eq("ativo", true)
    .maybeSingle();

  if (error) throw new Error(`Erro ao carregar integração: ${error.message}`);
  if (!data) {
    throw new Error(
      "Nenhuma integração de WhatsApp ativa. Configure em Configurações > Integrações.",
    );
  }
  return data as IntegracaoAtiva;
}

export async function criarWhatsAppService(supabase: SupabaseClient): Promise<WhatsAppService> {
  const integracao = await carregarIntegracaoAtiva(supabase);
  return new WhatsAppService(integracao);
}
