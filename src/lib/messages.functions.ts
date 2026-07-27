import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const iniciarSchema = z.object({
  mensagem: z.string().min(2).max(2000),
  tipo_envio: z.enum(["todos", "individual", "aniversariantes"]),
  cliente_id: z.string().uuid().optional().nullable(),
  imagem_url: z.string().url().optional().nullable(),
});

/**
 * Cria a campanha e enfileira um `historico_envios` por destinatário.
 * Não envia nada ainda — quem dispara cada contato é `enviarContatoCampanha`,
 * chamada pelo cliente uma vez por item da fila retornada aqui (veja
 * CampaignService.server.ts para o porquê dessa divisão em duas etapas).
 */
export const iniciarCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => iniciarSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { CampaignService } = await import("./whatsapp/CampaignService.server");
    const service = await CampaignService.create(context.supabase, context.userId);
    const resultado = await service.iniciar(data);
    return { ...resultado, provider: service.providerName };
  });

const enviarContatoSchema = z.object({
  historico_id: z.string().uuid(),
  telefone: z.string().min(3),
  mensagem: z.string().min(1),
  imagem_url: z.string().url().optional().nullable(),
});

export const enviarContatoCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => enviarContatoSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { CampaignService } = await import("./whatsapp/CampaignService.server");
    const service = await CampaignService.create(context.supabase, context.userId);
    return service.enviarUm(data.historico_id, data.telefone, data.mensagem, data.imagem_url);
  });
