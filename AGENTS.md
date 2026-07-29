# Banco compartilhado entre clientes — leia antes de mexer

Este painel é um de vários. **Todos os clientes dividem o mesmo projeto
Supabase** (`aelhxgkwuzkqhssaenly`); cada um tem repositório e domínio próprios.
A separação dos dados é feita por `empresa_id` + RLS.

> **Regra absoluta:** nenhum cliente pode ver cliente, campanha, histórico ou
> integração de outro. Vale para tela, para chamada direta de API e para
> qualquer migration.

## Antes de qualquer mudança em schema, RLS ou variável de ambiente

1. `SELECT * FROM public.auditar_isolamento();` — nenhuma linha `CRITICO`
2. Faça a mudança
3. Rode a auditoria de novo
4. `node scripts/testar-isolamento.mjs <email>:<senha> <email2>:<senha2>` —
   precisa terminar em "Isolamento íntegro."

**"O SQL rodou sem erro" não prova isolamento, e "compila" não prova que
funciona.** Já aconteceu de as policies estarem escritas certas, o script rodar
limpo, e os três painéis listarem a mesma base de clientes: uma policy antiga
`USING (true)` sobreviveu, e no Postgres policies permissivas **se somam** — uma
só liberando tudo anula todas as outras. Verifique o resultado que o usuário vê,
não o pedaço que você acabou de editar.

## Tabela nova com dado de cliente

Precisa dos quatro itens, senão vaza: coluna `empresa_id NOT NULL` com
`DEFAULT public.empresa_do_usuario()`, `ENABLE ROW LEVEL SECURITY`, policy
`FOR ALL TO authenticated` com `USING` **e** `WITH CHECK` filtrando por
`empresa_do_usuario()`, e índice em `empresa_id`.

`UNIQUE` nunca global — sempre `(empresa_id, campo)`.

## Mudou `.env`? A Vercel não sabe

`.env` é gitignored e não vai para o deploy. Toda variável precisa ser cadastrada
na Vercel **e o projeto redeployado** — variável nova não entra em build que já
existe. Pasta clonada de outro cliente vem com as variáveis do Supabase dele
apontando para o projeto antigo.

Para conferir com qual banco o site publicado fala, baixe o bundle e procure o
id do projeto — não confie no `.env` local.

## Procedimento completo

`supabase/PADRAO-NOVO-CLIENTE.md` — entrada de cliente novo, variáveis da
Vercel, e tabela de sintoma → causa.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
