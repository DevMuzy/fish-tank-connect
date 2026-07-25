import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";

const generateSchema = z.object({
  ideia: z.string().min(2).max(500),
  tipo: z
    .enum([
      "promocao",
      "produto_novo",
      "oferta_relampago",
      "cliente_fiel",
      "aniversario",
      "comunicado",
      "aviso",
      "livre",
    ])
    .default("livre"),
});

const systemPrompt = `Você é um especialista em copywriting para WhatsApp de peixarias.
Sua função é transformar ideias simples em mensagens curtas, elegantes, humanizadas e persuasivas, prontas para envio.

Regras obrigatórias:
- Sempre em português do Brasil.
- Máximo 4 parágrafos curtos.
- Use no máximo 2 emojis, sempre relacionados a peixaria (🐟 🦐 🦀 🐠 🌊 🔥 🎉 ❤️) e apenas quando fizer sentido.
- Nunca pareça spam. Nada de CAIXA ALTA gritando ou excesso de "!!!".
- Tom acolhedor, próximo, profissional.
- Não invente descontos, preços ou prazos que não estejam na ideia do usuário.
- Não use hashtags.
- Não assine com nome de empresa (o proprietário edita depois).
- Retorne apenas o texto final da mensagem, sem introduções nem explicações.`;

const tipoInstrucoes: Record<string, string> = {
  promocao: "Formato: promoção pontual. Destaque valor, urgência sutil e chamada para visita.",
  produto_novo: "Formato: apresentação de produto novo. Destaque frescor e novidade.",
  oferta_relampago: "Formato: oferta relâmpago. Urgência clara, prazo curto.",
  cliente_fiel: "Formato: agradecimento a cliente fiel. Tom caloroso e exclusivo.",
  aniversario: "Formato: mensagem de aniversário. Carinho e cuidado, sem forçar venda.",
  comunicado: "Formato: comunicado informativo. Direto, cordial e claro.",
  aviso: "Formato: aviso importante. Objetivo e transparente.",
  livre: "Formato livre. Escolha o tom mais adequado à ideia enviada.",
};

export const gerarMensagemIA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => generateSchema.parse(data))
  .handler(async ({ data }) => {
    const { createGeminiGateway } = await import("./ai-gateway.server");
    const gateway = createGeminiGateway();

    const { text } = await generateText({
      model: gateway("gemini-flash-latest"),
      system: systemPrompt,
      prompt: `${tipoInstrucoes[data.tipo]}\n\nIdeia do usuário:\n"${data.ideia}"\n\nGere a mensagem final:`,
    });

    return { mensagem: text.trim() };
  });
