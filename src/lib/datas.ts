/**
 * Datas de nascimento — o fuso horário estraga as duas pontas se deixarmos
 * o JavaScript decidir sozinho.
 *
 * `clientes.data_nascimento` é uma coluna DATE: o Postgres devolve "2004-02-10",
 * sem hora e sem fuso, porque aniversário é um dia do calendário, não um
 * instante no tempo. O problema é que `new Date("2004-02-10")` interpreta a
 * string como meia-noite **UTC** (regra do próprio ECMAScript para datas sem
 * hora). Ao formatar no horário do Brasil (UTC-3) aquilo vira 21h do dia 09, e
 * a tela mostra a data um dia antes da que foi digitada.
 */

/** Onde as lojas ficam. O servidor da Vercel roda em UTC, não aqui. */
const FUSO_DA_LOJA = "America/Sao_Paulo";

/**
 * Converte o "YYYY-MM-DD" do banco numa Date à meia-noite **local**.
 * Use sempre isto para exibir ou comparar data de nascimento — nunca
 * `new Date(string)` direto.
 */
export function dataDoBanco(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * Dia e mês de hoje no fuso da loja.
 *
 * Necessário porque o servidor roda em UTC: das 21h à meia-noite no Brasil, lá
 * já é o dia seguinte. Sem isto, um disparo para aniversariantes feito à noite
 * pegaria os aniversariantes de amanhã e deixaria os de hoje sem mensagem.
 */
export function hojeNaLoja(): { dia: number; mes: number; ano: number } {
  // en-CA formata como YYYY-MM-DD, que é o que queremos fatiar.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_LOJA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { dia, mes, ano };
}

/** `true` se a data de nascimento cai no dia de hoje, no fuso da loja. */
export function fazAniversarioHoje(isoNascimento: string): boolean {
  const nascimento = dataDoBanco(isoNascimento);
  const hoje = hojeNaLoja();
  return nascimento.getMonth() + 1 === hoje.mes && nascimento.getDate() === hoje.dia;
}
