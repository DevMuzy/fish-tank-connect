import { createServerFn } from "@tanstack/react-start";
import { requireAuthDaEmpresa } from "@/integrations/supabase/empresa-middleware";
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
  .middleware([requireAuthDaEmpresa])
  .inputValidator((data: unknown) => iniciarSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { CampaignService } = await import("./whatsapp/CampaignService.server");
    const service = await CampaignService.create(context.supabase, context.userId);
    const resultado = await service.iniciar(data);
    return { ...resultado, provider: service.providerName };
  });

// Só o id da linha da fila. Telefone e texto NÃO são aceitos do cliente: o
// servidor lê os dois da linha que ele mesmo reservou, sob RLS. Enquanto eles
// vinham por parâmetro, quem decidia o número discado era o estado da tela — e
// um erro ali mandaria mensagem de uma empresa para o contato de outra.
const enviarContatoSchema = z.object({
  historico_id: z.string().uuid(),
});

export const enviarContatoCampanha = createServerFn({ method: "POST" })
  .middleware([requireAuthDaEmpresa])
  .inputValidator((data: unknown) => enviarContatoSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { CampaignService } = await import("./whatsapp/CampaignService.server");
    const service = await CampaignService.create(context.supabase, context.userId);
    return service.enviarUm(data.historico_id);
  });
