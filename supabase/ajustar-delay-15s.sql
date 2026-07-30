-- ============================================================================
-- DELAY ENTRE ENVIOS: 12s → 15s
--
-- O valor que manda no disparo é `empresas.delay_envio_ms` — o código só lê
-- daqui. Alterar a constante no repositório sem rodar isto não muda nada no
-- envio real; muda apenas a estimativa de duração exibida antes de começar.
--
-- Ordem importa: sobe os valores primeiro, depois aperta o piso. Ao contrário,
-- o CHECK novo rejeitaria as linhas que ainda estão em 12000.
-- ============================================================================

-- 1. Sobe quem está abaixo (inclusive quem já estava exatamente em 12000).
UPDATE public.empresas
   SET delay_envio_ms = 15000
 WHERE delay_envio_ms < 15000;

-- 2. Cliente novo nasce com 15s.
ALTER TABLE public.empresas
  ALTER COLUMN delay_envio_ms SET DEFAULT 15000;

-- 3. Piso no banco: nem por SQL alguém baixa disso.
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_delay_minimo;
ALTER TABLE public.empresas
  ADD CONSTRAINT empresas_delay_minimo CHECK (delay_envio_ms >= 15000);

-- ============================================================================
-- CONFERÊNCIA — as três empresas em 15000.
-- ============================================================================
SELECT slug, nome, delay_envio_ms,
       (delay_envio_ms / 1000) || 's entre cada envio' AS na_pratica
  FROM public.empresas
 ORDER BY nome;
