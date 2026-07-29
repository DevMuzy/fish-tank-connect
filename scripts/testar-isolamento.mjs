/**
 * Teste de isolamento entre empresas — ponta a ponta, contra o banco de verdade.
 *
 * Existe porque conferir o SQL não é suficiente. Já aconteceu: as policies
 * estavam escritas certas, o script rodou sem erro, e os três painéis
 * continuavam listando a mesma base de clientes. O que encontrou o problema foi
 * exatamente isto — fazer login como cada cliente e olhar o que ele recebe.
 *
 * Rode ANTES de entregar painel para cliente novo, e DEPOIS de qualquer mexida
 * em RLS ou em migration.
 *
 * Uso (as senhas ficam só na linha de comando, nunca em arquivo):
 *   node scripts/testar-isolamento.mjs email:senha email:senha ...
 *
 * Exemplo:
 *   node scripts/testar-isolamento.mjs \
 *     tedson@ambientar.com:123456789 \
 *     katyusia@imperio.com:123456789
 *
 * Sai com código 1 se qualquer cliente enxergar dado de outro.
 */
import { readFileSync } from "node:fs";

const TABELAS = ["clientes", "mensagens", "historico_envios", "integracoes_whatsapp"];

function lerEnv() {
  const texto = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const pega = (chave) =>
    texto.match(new RegExp(`^${chave}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
  const url = pega("VITE_SUPABASE_URL");
  const key = pega("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / PUBLISHABLE_KEY ausentes no .env");
  return { url, key };
}

async function logar({ url, key }, email, senha) {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falhou para ${email}: ${j.error_code ?? j.msg}`);
  return j.access_token;
}

async function buscar({ url, key }, token, caminho) {
  const headers = { apikey: key };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${url}/rest/v1/${caminho}`, { headers });
  const corpo = await r.json();
  if (!Array.isArray(corpo)) throw new Error(`${caminho}: ${JSON.stringify(corpo).slice(0, 160)}`);
  return corpo;
}

const cfg = lerEnv();
const credenciais = process.argv.slice(2).map((a) => {
  const i = a.indexOf(":");
  if (i < 1) throw new Error(`credencial inválida: "${a}" — use email:senha`);
  return { email: a.slice(0, i), senha: a.slice(i + 1) };
});

if (credenciais.length < 2) {
  console.error("Informe pelo menos 2 logins de empresas diferentes — o teste compara um contra o outro.");
  process.exit(2);
}

const falhas = [];
const visto = [];

console.log(`Banco: ${cfg.url}\n`);

// -------------------------------------------------- 1. Anônimo não lê nada --
// Sem login não deve sair uma linha. Se sair, a base está aberta na internet.
for (const tabela of TABELAS) {
  const linhas = await buscar(cfg, null, `${tabela}?select=id`);
  if (linhas.length > 0) {
    falhas.push(`ANÔNIMO leu ${linhas.length} linha(s) de ${tabela} — base exposta sem login`);
  }
}
console.log(`[1/3] anônimo sem acesso: ${falhas.length === 0 ? "OK" : "FALHOU"}`);

// ------------------------------------ 2. Cada login resolve a UMA empresa --
for (const { email, senha } of credenciais) {
  const token = await logar(cfg, email, senha);
  const empresas = await buscar(cfg, token, "empresas?select=id,slug,nome");

  if (empresas.length !== 1) {
    falhas.push(`${email} resolve a ${empresas.length} empresas (esperado 1)`);
    continue;
  }

  const dados = {};
  for (const tabela of TABELAS) {
    dados[tabela] = (await buscar(cfg, token, `${tabela}?select=id`)).map((r) => r.id);
  }
  visto.push({ email, empresa: empresas[0], dados });
}
console.log(`[2/3] cada login em uma empresa: ${visto.length === credenciais.length ? "OK" : "FALHOU"}`);

// ------------------------------------- 3. Nenhum par compartilha uma linha --
// O teste de verdade: interseção de ids entre dois clientes tem que ser vazia.
for (let i = 0; i < visto.length; i++) {
  for (let j = i + 1; j < visto.length; j++) {
    const a = visto[i];
    const b = visto[j];
    if (a.empresa.slug === b.empresa.slug) continue; // dois logins da mesma loja: ok
    for (const tabela of TABELAS) {
      const comuns = a.dados[tabela].filter((id) => b.dados[tabela].includes(id));
      if (comuns.length > 0) {
        falhas.push(
          `VAZAMENTO em ${tabela}: ${a.empresa.slug} e ${b.empresa.slug} veem ` +
            `${comuns.length} linha(s) em comum (ex: ${comuns[0]})`,
        );
      }
    }
  }
}
console.log(`[3/3] nenhum dado cruzado: ${falhas.length === 0 ? "OK" : "FALHOU"}\n`);

// ----------------------------------------------------------------- Resumo --
console.log("O que cada login enxerga:");
for (const v of visto) {
  const n = TABELAS.map((t) => `${t.replace("integracoes_whatsapp", "integr")}=${v.dados[t].length}`);
  console.log(`  ${v.empresa.slug.padEnd(14)} ${v.email.padEnd(26)} ${n.join("  ")}`);
}

if (falhas.length > 0) {
  console.error(`\n=== ${falhas.length} FALHA(S) ===`);
  for (const f of falhas) console.error(`  - ${f}`);
  console.error("\nNÃO entregue painel para cliente novo. Rode supabase/corrigir-isolamento.sql.");
  process.exit(1);
}

console.log("\nIsolamento íntegro.");
