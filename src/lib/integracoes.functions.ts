import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().min(2).max(80),
  provedor: z.enum(["mock", "evolution", "zapi", "meta"]),
  url_base: z.string().url().optional().nullable().or(z.literal("")),
  token: z.string().optional().nullable().or(z.literal("")),
  numero_remetente: z.string().min(3).max(40).optional().nullable().or(z.literal("")),
  ativo: z.boolean().default(false),
  observacoes: z.string().max(400).optional().nullable().or(z.literal("")),
});

export const salvarIntegracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Se marcada como ativa, desativa todas as outras primeiro
    if (data.ativo) {
      await supabase
        .from("integracoes_whatsapp")
        .update({ ativo: false })
        .neq("id", data.id ?? "00000000-0000-0000-0000-000000000000");
    }

    const payload = {
      nome: data.nome,
      provedor: data.provedor,
      url_base: data.url_base || null,
      token: data.token || null,
      numero_remetente: data.numero_remetente || null,
      ativo: data.ativo,
      observacoes: data.observacoes || null,
      created_by: userId,
    };

    if (data.id) {
      const { error } = await supabase
        .from("integracoes_whatsapp")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabase
      .from("integracoes_whatsapp")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: row.id as string };
  });

export const excluirIntegracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("integracoes_whatsapp")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const testarConexao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: integ, error } = await context.supabase
      .from("integracoes_whatsapp")
      .select("id, nome, provedor, url_base, token, numero_remetente, ativo, status_conexao")
      .eq("id", data.id)
      .single();
    if (error) throw error;

    const { WhatsAppService } = await import("./whatsapp/WhatsAppService.server");
    const service = new WhatsAppService(integ as never);
    const health = await service.healthCheck();
    const novoStatus = health.ok ? (integ.provedor === "mock" ? "simulado" : "conectado") : "erro";
    await context.supabase
      .from("integracoes_whatsapp")
      .update({ status_conexao: novoStatus, ultimo_check: new Date().toISOString() })
      .eq("id", data.id);
    return { ok: health.ok, detail: health.detail, status_conexao: novoStatus };
  });

export const gerarQrCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: integ, error } = await context.supabase
      .from("integracoes_whatsapp")
      .select("id, nome, provedor, url_base, token, numero_remetente, ativo, status_conexao")
      .eq("id", data.id)
      .single();
    if (error) throw error;

    const { WhatsAppService } = await import("./whatsapp/WhatsAppService.server");
    const service = new WhatsAppService(integ as never);
    const resultado = await service.getQrCode();

    if (resultado.ok) {
      const novoStatus = resultado.conectado ? "conectado" : "desconhecido";
      await context.supabase
        .from("integracoes_whatsapp")
        .update({ status_conexao: novoStatus, ultimo_check: new Date().toISOString() })
        .eq("id", data.id);
    }

    return resultado;
  });
