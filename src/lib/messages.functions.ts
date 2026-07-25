import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const disparoSchema = z.object({
  mensagem: z.string().min(2).max(2000),
  tipo_envio: z.enum(["todos", "individual", "aniversariantes"]),
  cliente_id: z.string().uuid().optional().nullable(),
  imagem_url: z.string().url().optional().nullable(),
});

/**
 * Endpoint fino: apenas valida o payload e delega ao CampaignService.
 * Toda a regra de negócio vive no backend, em serviços desacoplados
 * (`CampaignService` → `WhatsAppService` → `WhatsAppProvider`).
 */
export const enviarCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => disparoSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { CampaignService } = await import("./whatsapp/CampaignService.server");
    const service = await CampaignService.create(context.supabase, context.userId);
    return service.executar(data);
  });
