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

export type QrCodeResultado = {
  ok: boolean;
  conectado?: boolean;
  qrCodeBase64?: string;
  error?: string;
};

export type SendParams = {
  telefone: string;
  mensagem: string;
  imagemUrl?: string | null;
};

export interface WhatsAppProvider {
  name: string;
  send(params: SendParams): Promise<EnvioResultado>;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
  getQrCode?(): Promise<QrCodeResultado>;
}
