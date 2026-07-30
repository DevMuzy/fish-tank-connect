# Contexto obrigatório

Painel de relacionamento WhatsApp. **Este é um de vários painéis que dividem o
mesmo projeto Supabase** (`aelhxgkwuzkqhssaenly`). Cada cliente tem repositório e
domínio próprios; o banco é o mesmo. A separação é por `empresa_id` + RLS.

> **Regra absoluta:** nenhum cliente pode ver cliente, campanha, histórico ou
> integração de outro. Nem por bug de tela, nem por chamada direta de API, nem
> por descuido em migration.

## Ordem obrigatória em qualquer mudança de schema, RLS ou variável de ambiente

```
auditar → mudar → auditar → testar
```

1. `SELECT * FROM public.auditar_isolamento();` — nenhuma linha `CRITICO`
2. faça a mudança
3. rode a auditoria de novo
4. `node scripts/testar-isolamento.mjs <email>:<senha> <email2>:<senha2>` —
   precisa terminar em "Isolamento íntegro."

**"O SQL rodou sem erro" não prova isolamento. "Compila" não prova que
funciona.** Já aconteceu: policies escritas certas, script rodando limpo, e os
três painéis listando a mesma base de clientes — uma policy antiga
`USING (true)` sobreviveu, e no Postgres policies permissivas **se somam**.

Verifique o resultado que o usuário vê, não o pedaço que você acabou de editar.
Para saber com qual banco o site publicado fala, baixe o bundle e procure o id do
projeto — o `.env` local não diz nada sobre o deploy.

## Entrada de cliente novo

Leia **`supabase/PADRAO-NOVO-CLIENTE.md`** antes de começar. São 6 passos, e o
script `supabase/novo-cliente.sql` faz o trabalho de banco num passo só.

## Tabela nova com dado de cliente

Quatro itens, sem exceção — faltando um, a tabela vaza:

1. `empresa_id UUID NOT NULL REFERENCES empresas(id) DEFAULT public.empresa_do_usuario()`
2. `ENABLE ROW LEVEL SECURITY`
3. policy `FOR ALL TO authenticated` com `USING` **e** `WITH CHECK` filtrando por
   `empresa_do_usuario()`
4. índice em `empresa_id`

`UNIQUE` nunca global — sempre `(empresa_id, campo)`.

## Outros pontos que já causaram incidente

- **`.env` é gitignored e não vai para o deploy.** Toda variável precisa ser
  cadastrada na Vercel *e* o projeto redeployado. Pasta clonada de outro cliente
  vem com as variáveis do Supabase dele.
- **`VITE_EMPRESA_SLUG` e `EMPRESA_SLUG`** têm que existir as duas, com o mesmo
  valor: a primeira é embutida no build (navegador), a segunda fica só no
  servidor (middleware).
- **Delay entre envios mora em `empresas.delay_envio_ms`**, com piso de 15s no
  banco. Não voltar para constante de código: um repo por cliente faria o valor
  divergir.
- **Datas de nascimento**: `data_nascimento` é coluna DATE. Use
  `dataDoBanco()` / `fazAniversarioHoje()` de `src/lib/datas.ts`. Nunca
  `new Date(string)` direto — a string sem hora é lida como UTC e a data volta um
  dia.

## Comandos

```bash
npx tsc --noEmit -p tsconfig.json    # typecheck
npx vite build                       # build
node scripts/testar-isolamento.mjs   # teste de isolamento (ver argumentos acima)
```
