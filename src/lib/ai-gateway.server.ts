import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createGeminiGateway() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurado.");
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
}
