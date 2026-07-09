/**
 * Implementações dos provedores de WhatsApp.
 * Cada provedor implementa a interface WhatsAppProvider — trocar provedor
 * é apenas alterar a integração ativa no banco, sem tocar em regras de negócio.
 */
import type { EnvioResultado, IntegracaoAtiva, WhatsAppProvider } from "./types";

function normalizeTelefone(telefone: string): string {
  const digits = telefone.replace(/\D/g, "");
  // Se não tem código do país, presume Brasil (55)
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

// -------------------- MOCK / SIMULADO --------------------
function mockProvider(integracao: IntegracaoAtiva): WhatsAppProvider {
  return {
    name: "mock",
    async send({ telefone, mensagem }) {
      await new Promise((r) => setTimeout(r, 50));
      return {
        ok: true,
        status: "simulado",
        response: {
          provider: "mock",
          remetente: integracao.numero_remetente,
          destinatario: normalizeTelefone(telefone),
          preview: mensagem.slice(0, 60),
          timestamp: new Date().toISOString(),
        },
      };
    },
    async healthCheck() {
      return { ok: true, detail: "Provedor simulado — sempre disponível." };
    },
  };
}

// -------------------- EVOLUTION API --------------------
function evolutionProvider(integracao: IntegracaoAtiva): WhatsAppProvider {
  const baseUrl = integracao.url_base?.replace(/\/+$/, "") ?? "";
  const token = integracao.token ?? "";
  const instance = integracao.numero_remetente ?? "";

  return {
    name: "evolution",
    async send({ telefone, mensagem }): Promise<EnvioResultado> {
      if (!baseUrl || !token) {
        return { ok: false, status: "falhou", error: "Evolution API não configurada (url/token)." };
      }
      try {
        const res = await fetch(`${baseUrl}/message/sendText/${instance}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: token,
          },
          body: JSON.stringify({
            number: normalizeTelefone(telefone),
            text: mensagem,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          return { ok: false, status: "falhou", response: data, error: `HTTP ${res.status}` };
        }
        return { ok: true, status: "enviado", response: data };
      } catch (e) {
        return { ok: false, status: "falhou", error: (e as Error).message };
      }
    },
    async healthCheck() {
      if (!baseUrl || !token) return { ok: false, detail: "URL/token ausente." };
      try {
        const res = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
          headers: { apikey: token },
        });
        return { ok: res.ok, detail: `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
  };
}

// -------------------- Z-API --------------------
function zapiProvider(integracao: IntegracaoAtiva): WhatsAppProvider {
  const baseUrl = integracao.url_base?.replace(/\/+$/, "") ?? "";
  const token = integracao.token ?? "";

  return {
    name: "zapi",
    async send({ telefone, mensagem }): Promise<EnvioResultado> {
      if (!baseUrl || !token) {
        return { ok: false, status: "falhou", error: "Z-API não configurada (url/token)." };
      }
      try {
        const res = await fetch(`${baseUrl}/send-text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Client-Token": token,
          },
          body: JSON.stringify({
            phone: normalizeTelefone(telefone),
            message: mensagem,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) return { ok: false, status: "falhou", response: data, error: `HTTP ${res.status}` };
        return { ok: true, status: "enviado", response: data };
      } catch (e) {
        return { ok: false, status: "falhou", error: (e as Error).message };
      }
    },
  };
}

// -------------------- META CLOUD API --------------------
function metaProvider(integracao: IntegracaoAtiva): WhatsAppProvider {
  const phoneId = integracao.numero_remetente ?? "";
  const token = integracao.token ?? "";
  const baseUrl = integracao.url_base?.replace(/\/+$/, "") ?? "https://graph.facebook.com/v20.0";

  return {
    name: "meta",
    async send({ telefone, mensagem }): Promise<EnvioResultado> {
      if (!phoneId || !token) {
        return { ok: false, status: "falhou", error: "Meta Cloud API não configurada." };
      }
      try {
        const res = await fetch(`${baseUrl}/${phoneId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: normalizeTelefone(telefone),
            type: "text",
            text: { body: mensagem },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) return { ok: false, status: "falhou", response: data, error: `HTTP ${res.status}` };
        return { ok: true, status: "enviado", response: data };
      } catch (e) {
        return { ok: false, status: "falhou", error: (e as Error).message };
      }
    },
  };
}

export function resolveProvider(integracao: IntegracaoAtiva): WhatsAppProvider {
  switch (integracao.provedor) {
    case "evolution":
      return evolutionProvider(integracao);
    case "zapi":
      return zapiProvider(integracao);
    case "meta":
      return metaProvider(integracao);
    case "mock":
    default:
      return mockProvider(integracao);
  }
}
