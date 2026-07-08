import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const disparoSchema = z.object({
  mensagem: z.string().min(2).max(2000),
  tipo_envio: z.enum(["todos", "individual", "aniversariantes"]),
  cliente_id: z.string().uuid().optional().nullable(),
});

export const enviarCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => disparoSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { getAdapter } = await import("./whatsapp.server");
    const adapter = getAdapter();

    // Selecionar destinatários conforme tipo
    let query = supabase.from("clientes").select("id, nome, telefone, data_nascimento");
    if (data.tipo_envio === "individual") {
      if (!data.cliente_id) throw new Error("cliente_id é obrigatório para envio individual.");
      query = query.eq("id", data.cliente_id);
    } else if (data.tipo_envio === "aniversariantes") {
      const hoje = new Date();
      const mm = String(hoje.getMonth() + 1).padStart(2, "0");
      const dd = String(hoje.getDate()).padStart(2, "0");
      // Filtro por mês/dia via SQL fragment
      const { data: aniv, error } = await supabase.rpc as unknown as never;
      void aniv;
      void error;
      const { data: todos, error: errAll } = await supabase
        .from("clientes")
        .select("id, nome, telefone, data_nascimento");
      if (errAll) throw errAll;
      const alvo = (todos || []).filter((c) => {
        const d = new Date(c.data_nascimento);
        return (
          String(d.getUTCMonth() + 1).padStart(2, "0") === mm &&
          String(d.getUTCDate()).padStart(2, "0") === dd
        );
      });
      return await executarEnvio(supabase, adapter, alvo, data.mensagem, "aniversariantes", userId);
    }

    const { data: destinatarios, error } = await query;
    if (error) throw error;
    if (!destinatarios || destinatarios.length === 0) {
      throw new Error("Nenhum destinatário encontrado.");
    }

    return await executarEnvio(
      supabase,
      adapter,
      destinatarios,
      data.mensagem,
      data.tipo_envio,
      userId,
    );
  });

async function executarEnvio(
  supabase: any,
  adapter: { send: (p: { telefone: string; mensagem: string }) => Promise<any>; name: string },
  destinatarios: Array<{ id: string; telefone: string; nome: string }>,
  mensagem: string,
  tipo_envio: string,
  userId: string,
) {
  // Cria registro da campanha
  const { data: msg, error: msgErr } = await supabase
    .from("mensagens")
    .insert({
      mensagem,
      tipo_envio,
      cliente_id: tipo_envio === "individual" ? destinatarios[0]?.id : null,
      quantidade_destinatarios: destinatarios.length,
      status: "concluido",
      created_by: userId,
    })
    .select()
    .single();
  if (msgErr) throw msgErr;

  let sucesso = 0;
  let falha = 0;
  const linhas: Array<Record<string, unknown>> = [];
  for (const d of destinatarios) {
    const r = await adapter.send({ telefone: d.telefone, mensagem });
    if (r.ok) sucesso++;
    else falha++;
    linhas.push({
      mensagem_id: msg.id,
      cliente_id: d.id,
      telefone: d.telefone,
      status: r.status,
      resposta_api: r.response ?? { error: r.error },
    });
  }

  if (linhas.length > 0) {
    const { error: histErr } = await supabase.from("historico_envios").insert(linhas);
    if (histErr) throw histErr;
  }

  const statusFinal = falha === 0 ? "concluido" : sucesso === 0 ? "falhou" : "parcial";
  if (statusFinal !== "concluido") {
    await supabase.from("mensagens").update({ status: statusFinal }).eq("id", msg.id);
  }

  return {
    mensagem_id: msg.id,
    total: destinatarios.length,
    sucesso,
    falha,
    provider: adapter.name,
  };
}
