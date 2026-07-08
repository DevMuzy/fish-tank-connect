/**
 * WhatsApp adapter — arquitetura preparada para múltiplos provedores.
 * Atualmente em modo simulado: registra o envio mas não chama nenhuma API.
 * Para ativar Evolution / Z-API / Meta Cloud, implemente um novo adapter
 * seguindo a interface `WhatsAppAdapter` e troque `getAdapter()`.
 */

export type WhatsAppSendResult = {
  ok: boolean;
  status: "enviado" | "falhou" | "simulado";
  response?: Record<string, unknown>;
  error?: string;
};

export interface WhatsAppAdapter {
  name: string;
  send(params: { telefone: string; mensagem: string }): Promise<WhatsAppSendResult>;
}

const mockAdapter: WhatsAppAdapter = {
  name: "mock",
  async send({ telefone, mensagem }) {
    await new Promise((r) => setTimeout(r, 80));
    return {
      ok: true,
      status: "simulado",
      response: {
        provider: "mock",
        telefone,
        preview: mensagem.slice(0, 60),
        timestamp: new Date().toISOString(),
      },
    };
  },
};

export function getAdapter(): WhatsAppAdapter {
  // Futuro: escolher via env WHATSAPP_PROVIDER
  return mockAdapter;
}
