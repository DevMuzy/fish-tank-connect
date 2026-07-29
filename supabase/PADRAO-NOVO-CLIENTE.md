# Entrada de cliente novo — procedimento

Todos os clientes moram num **único** projeto Supabase
(`aelhxgkwuzkqhssaenly`). Cada um tem seu repositório no GitHub e seu domínio na
Vercel, mas o banco é o mesmo. A separação é feita por `empresa_id` + RLS.

> **A regra que não se negocia:** nenhum cliente pode ver cliente, campanha,
> histórico ou integração de outro. Nem por bug de tela, nem por chamada direta
> de API, nem por descuido em migration.

## Por que este documento existe

Na entrada do segundo e do terceiro cliente, os três painéis passaram a listar a
**mesma base de clientes**. As policies estavam escritas certas e o SQL rodou sem
erro nenhum — mas uma policy antiga `USING (true)` sobreviveu. No Postgres,
policies permissivas **se somam**: uma só liberando tudo anula todas as outras.

O erro de fundo não foi o SQL. Foi ter tratado *"rodou sem erro"* como
*"está isolado"*. As duas coisas não têm relação.

---

## Os 6 passos

### 1. Auditar antes de mexer

```sql
SELECT * FROM public.auditar_isolamento();
```

Nenhuma linha `CRITICO`. **Se houver, pare** — mais um cliente significa mais uma
base exposta. Rode `supabase/corrigir-isolamento.sql` primeiro.

Se a função não existir, instale com `supabase/auditoria-isolamento.sql`.

### 2. Criar empresa e login

Abra `supabase/novo-cliente.sql`, copie para o SQL Editor, preencha o bloco
`CONFIGURE` **lá dentro** e rode.

> Preencha no SQL Editor, **nunca no arquivo**. Senha commitada fica no histórico
> do git para sempre, mesmo depois de trocada.

O script se recusa a criar nada se a auditoria acusar problema crítico, e desfaz
tudo se a própria criação quebrar o isolamento.

O `slug` precisa ser **idêntico** ao que vai na Vercel. Só minúsculas e hífen.

### 3. Repositório próprio

```bash
gh repo create DevMuzy/<Nome>-Automacao --private
git remote set-url origin https://github.com/DevMuzy/<Nome>-Automacao.git
git push -u origin main
```

Confira o `remote` **antes** de qualquer push — a pasta nova costuma vir clonada
de outro cliente e aponta para o repositório dele.

### 4. Variáveis na Vercel

Projeto → Settings → Environment Variables, nos três ambientes
(Production, Preview, Development):

| Variável | Valor |
|---|---|
| `VITE_EMPRESA_SLUG` | o slug do passo 2 |
| `EMPRESA_SLUG` | o mesmo slug |
| `VITE_SUPABASE_URL` | `https://aelhxgkwuzkqhssaenly.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `aelhxgkwuzkqhssaenly` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | a do banco compartilhado |
| `SUPABASE_URL` | mesma URL |
| `SUPABASE_PROJECT_ID` | mesmo id |
| `SUPABASE_PUBLISHABLE_KEY` | mesma chave |
| `GEMINI_API_KEY` | a chave da IA |

São **duas** variáveis de slug porque fazem trabalhos diferentes: a `VITE_` é
embutida no build e usada pelo navegador; a sem prefixo fica só no servidor, para
o middleware. O Vite só expõe ao navegador o que começa com `VITE_`.

**Sem aspas no campo Value.** No `.env` local as aspas são sintaxe de shell e são
removidas na leitura; na Vercel o valor é literal, e `"slug"` com aspas nunca casa
com o `slug` do banco — o painel bloqueia todo mundo (falha fechada).

**Erro que já aconteceu:** trocar o `.env` local e esquecer a Vercel. O `.env` é
gitignored e **não** vai para o deploy. Se a pasta veio clonada de outro cliente,
as variáveis do Supabase na Vercel apontam para o projeto **antigo** dele.

### 5. Deploy

`Deployments → ⋯ → Redeploy`. Variável nova **não** entra em build que já existe.

Confirme com qual banco o site publicado está falando:

```bash
curl -s https://<dominio>/auth | tr -d '\000' > /tmp/p.html
ASSET=$(grep -oE '"/assets/index-[^"]*\.js"' /tmp/p.html | tr -d '"' | head -1)
curl -s "https://<dominio>$ASSET" | grep -c "aelhxgkwuzkqhssaenly"   # tem que ser 1
```

### 6. Provar o isolamento

```bash
node scripts/testar-isolamento.mjs \
  <email-novo>:<senha> \
  tedson@ambientar.com:<senha> \
  katyusia@imperio.com:<senha>
```

Precisa terminar em **"Isolamento íntegro."** Ele faz login como cada cliente e
compara os ids que cada um recebe — se dois clientes virem a mesma linha, falha.

**Só entregue o painel depois deste passo passar.**

---

## Ao criar tabela nova

Qualquer tabela que guarde dado de cliente precisa dos quatro itens. Faltando um,
a tabela vaza:

```sql
ALTER TABLE public.nova_tabela
  ADD COLUMN empresa_id UUID NOT NULL
    REFERENCES public.empresas(id) ON DELETE RESTRICT
    DEFAULT public.empresa_do_usuario();          -- 1. coluna + default

ALTER TABLE public.nova_tabela ENABLE ROW LEVEL SECURITY;   -- 2. RLS ligada

CREATE POLICY rls_nova_tabela_empresa ON public.nova_tabela -- 3. policy
  FOR ALL TO authenticated
  USING      (empresa_id = (SELECT public.empresa_do_usuario()))
  WITH CHECK (empresa_id = (SELECT public.empresa_do_usuario()));

CREATE INDEX idx_nova_tabela_empresa ON public.nova_tabela (empresa_id);  -- 4.
```

O `DEFAULT public.empresa_do_usuario()` é o que evita a classe inteira de bugs em
que o código esquece de preencher `empresa_id`: quem carimba é o banco.

A auditoria descobre tabela multi-cliente **pela existência da coluna
`empresa_id`**, não por lista fixa — então tabela nova entra na verificação
sozinha.

`UNIQUE` nunca pode ser global: sempre `(empresa_id, campo)`. Um `UNIQUE` global
faz a base de um cliente bloquear cadastro na do outro, e a mensagem de erro
entrega que aquele registro existe em outra base.

---

## Quando algo dá errado

| Sintoma | Causa | Onde olhar |
|---|---|---|
| "Painel sem VITE_EMPRESA_SLUG configurado" | variável ausente no build | Vercel + redeploy; ou aba com cache antigo |
| "Não foi possível validar seu acesso" | o site fala com o Supabase errado | passo 4 — variáveis do Supabase na Vercel |
| "Este acesso não pertence a este painel" | slug do deploy ≠ empresa do login | comparar `VITE_EMPRESA_SLUG` com `empresas.slug` |
| "Invalid login credentials" | login existe no banco antigo, não no compartilhado | passo 2 |
| Cliente vê base de outro | policy `USING (true)` sobreviveu | `corrigir-isolamento.sql` |
| "Nenhuma integração ativa" | Evolution não cadastrada nesta empresa | Configurações > Integrações no painel |

## Arquivos

| Arquivo | Para quê |
|---|---|
| `setup-banco-compartilhado.sql` | montar o banco do zero |
| `auditoria-isolamento.sql` | instalar `auditar_isolamento()` |
| `novo-cliente.sql` | entrada de cliente novo |
| `corrigir-isolamento.sql` | consertar RLS furada |
| `scripts/testar-isolamento.mjs` | provar isolamento ponta a ponta |
