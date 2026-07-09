/**
 * Tipos compartilhados do módulo WhatsApp.
 * Camada agnóstica de provedor — nunca deve importar SDKs específicos.
 */

export type StatusEnvio = "aguardando" | "enviando" | "enviado" | "falhou";

export type IntegracaoAtiva = {
  id: string;
  nome: string;
  provedor: string;
  url_base: string | null;
  token: string | null;
  numero_remetente: string | null;
  ativo: boolean;
  status_conexao: string;
};

export type EnvioResultado = {
  ok: boolean;
  status: "enviado" | "falhou" | "simulado";
  response?: Record<string, unknown>;
  error?: string;
};

export interface WhatsAppProvider {
  name: string;
  send(params: { telefone: string; mensagem: string }): Promise<EnvioResultado>;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
