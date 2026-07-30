/**
 * Parâmetros de disparo compartilhados entre servidor e tela.
 * Módulo sem `.server` de propósito: a tela de disparo precisa do delay para
 * estimar a duração da fila antes de chamar o servidor, e duplicar o número
 * nos dois lados garantiria que uma hora eles divergem.
 */

/**
 * Espaçamento entre um envio e o próximo, aplicado a TODO disparo — inclusive
 * os de um único destinatário. Fixo (sem jitter) por exigência do cliente.
 *
 * O valor que MANDA vive em `empresas.delay_envio_ms` no banco: cada cliente
 * tem seu repositório, e uma constante duplicada em N repos divergiria na
 * primeira edição distraída. `iniciar()` devolve o valor do banco e é ele que
 * o loop de disparo obedece.
 *
 * Esta constante é só o palpite para a estimativa de duração que a tela mostra
 * ANTES de chamar o servidor, quando ainda não há valor do banco em mãos.
 * Mantida igual ao default da coluna.
 */
export const DELAY_ENTRE_ENVIOS_MS = 15_000;
