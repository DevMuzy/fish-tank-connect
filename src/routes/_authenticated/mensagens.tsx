import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn as tsrUseServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Loader2, Image as ImageIcon, X, Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gerarMensagemIA } from "@/lib/ai.functions";
import { iniciarCampanha, enviarContatoCampanha } from "@/lib/messages.functions";
import { DELAY_ENTRE_ENVIOS_MS } from "@/lib/whatsapp/config";

type FalhaItem = { nome: string; telefone: string; erro: string };
type Progresso = {
  total: number;
  enviados: number;
  sucesso: number;
  falhas: FalhaItem[];
  concluido: boolean;
  cancelado: boolean;
  /** Removidos da fila por já terem recebido esse mesmo texto antes. */
  jaReceberam: number;
  delayMs: number;
};

/** "12 min" / "1h 05min" — para o operador saber quanto a fila ainda leva. */
function formatarDuracao(ms: number) {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 1) return "menos de 1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}min`;
}

export const Route = createFileRoute("/_authenticated/mensagens")({
  component: MensagensPage,
});

const modelos = [
  { id: "livre", label: "✍️ Livre", tipo: "livre" as const },
  { id: "promo", label: "🏷️ Promoção", tipo: "promocao" as const },
  { id: "novo", label: "🛋️ Novidade", tipo: "produto_novo" as const },
  { id: "relampago", label: "🔥 Oferta relâmpago", tipo: "oferta_relampago" as const },
  { id: "fiel", label: "❤️ Cliente fiel", tipo: "cliente_fiel" as const },
  { id: "aniv", label: "🎉 Aniversário", tipo: "aniversario" as const },
  { id: "com", label: "📢 Comunicado", tipo: "comunicado" as const },
  { id: "aviso", label: "⚠️ Aviso", tipo: "aviso" as const },
];

function MensagensPage() {
  const [destino, setDestino] = useState<"todos" | "individual" | "aniversariantes">("todos");
  const [clienteId, setClienteId] = useState<string>("");
  const [ideia, setIdeia] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [tipoModelo, setTipoModelo] = useState<(typeof modelos)[number]["tipo"]>("livre");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [imagemUrl, setImagemUrl] = useState<string | null>(null);
  const [uploadingImagem, setUploadingImagem] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [providerUsado, setProviderUsado] = useState("");
  const cancelarRef = useRef(false);
  // Trava síncrona: `disabled={enviando}` só vale depois do re-render, então
  // dois cliques no mesmo tick abririam duas campanhas com o mesmo texto.
  const emAndamentoRef = useRef(false);

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, telefone")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  // Qual provedor vai de fato disparar — evita prometer envio real quando a
  // integração ativa é o mock, e vice-versa.
  const { data: integracaoAtiva } = useQuery({
    queryKey: ["integracao-ativa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integracoes_whatsapp")
        .select("nome, provedor, status_conexao")
        .eq("ativo", true)
        .maybeSingle();
      if (error) throw error;
      return data as { nome: string; provedor: string; status_conexao: string } | null;
    },
  });

  const gerarIA = tsrUseServerFn(gerarMensagemIA);
  const iniciarFn = tsrUseServerFn(iniciarCampanha);
  const enviarContatoFn = tsrUseServerFn(enviarContatoCampanha);

  async function handleSelecionarImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem muito grande (máximo 5MB).");
      return;
    }
    setUploadingImagem(true);
    try {
      // O bucket é compartilhado entre as empresas, e a policy de upload exige
      // que o arquivo caia na pasta da própria empresa. Consultado a cada
      // upload em vez de cacheado no módulo: um cache sobreviveria à troca de
      // usuário e mandaria o anexo para a pasta errada.
      const { data: empresaId, error: empresaErr } = await supabase.rpc("empresa_do_usuario");
      if (empresaErr) throw empresaErr;
      if (!empresaId) throw new Error("Usuário sem empresa vinculada.");

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${empresaId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("campanhas").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("campanhas").getPublicUrl(path);
      setImagemUrl(data.publicUrl);
    } catch (err) {
      toast.error((err as Error).message || "Falha ao enviar imagem.");
    } finally {
      setUploadingImagem(false);
    }
  }

  const gerar = useMutation({
    mutationFn: async () => {
      if (!ideia.trim()) throw new Error("Escreva uma ideia para a IA transformar.");
      return await gerarIA({ data: { ideia: ideia.trim(), tipo: tipoModelo } });
    },
    onSuccess: (r) => {
      setMensagem(r.mensagem);
      toast.success("Mensagem gerada!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function cancelarEnvio() {
    cancelarRef.current = true;
    setProgresso((p) => (p ? { ...p, cancelado: true } : p));
  }

  async function iniciarEDisparar() {
    if (emAndamentoRef.current) return;
    if (!mensagem.trim()) return toast.error("Escreva ou gere uma mensagem antes de enviar.");
    if (destino === "individual" && !clienteId)
      return toast.error("Selecione um cliente destinatário.");

    emAndamentoRef.current = true;
    cancelarRef.current = false;
    setEnviando(true);
    try {
      const r = await iniciarFn({
        data: {
          mensagem: mensagem.trim(),
          tipo_envio: destino,
          cliente_id: destino === "individual" ? clienteId : null,
          imagem_url: imagemUrl,
        },
      });
      setProviderUsado(r.provider);
      setProgresso({
        total: r.fila.length,
        enviados: 0,
        sucesso: 0,
        falhas: [],
        concluido: false,
        cancelado: false,
        jaReceberam: r.jaReceberam,
        delayMs: r.delayMs,
      });

      let sucesso = 0;
      const falhas: FalhaItem[] = [];

      for (let i = 0; i < r.fila.length; i++) {
        if (cancelarRef.current) break;
        const item = r.fila[i];
        let resultado: { ok: boolean; erro?: string };
        try {
          resultado = await enviarContatoFn({
            data: {
              historico_id: item.historicoId,
              telefone: item.telefone,
              mensagem: mensagem.trim(),
              imagem_url: imagemUrl,
            },
          });
        } catch (e) {
          resultado = { ok: false, erro: (e as Error).message };
        }

        if (resultado.ok) sucesso++;
        else falhas.push({ nome: item.nome, telefone: item.telefone, erro: resultado.erro ?? "Erro desconhecido" });

        setProgresso({
          total: r.fila.length,
          enviados: i + 1,
          sucesso,
          falhas: [...falhas],
          concluido: false,
          cancelado: cancelarRef.current,
          jaReceberam: r.jaReceberam,
          delayMs: r.delayMs,
        });

        const isUltimo = i === r.fila.length - 1;
        if (!isUltimo && !cancelarRef.current) {
          await new Promise((res) => setTimeout(res, r.delayMs));
        }
      }

      const falha = falhas.length;
      const statusFinal = cancelarRef.current
        ? "parcial"
        : falha === 0
          ? "concluido"
          : sucesso === 0
            ? "falhou"
            : "parcial";
      await supabase
        .from("mensagens")
        .update({ status: statusFinal, sucesso, erros: falha })
        .eq("id", r.mensagemId);

      setProgresso((p) => (p ? { ...p, concluido: true } : p));
      const pulados = r.jaReceberam > 0 ? ` · ${r.jaReceberam} já haviam recebido` : "";
      toast.success(
        cancelarRef.current
          ? `Envio cancelado — ${sucesso}/${r.fila.length} entregues${pulados}`
          : `Envio concluído: ${sucesso}/${r.fila.length} entregues${pulados}`,
      );
      setMensagem("");
      setIdeia("");
      setImagemUrl(null);
    } catch (e) {
      toast.error((e as Error).message);
      setConfirmOpen(false);
    } finally {
      emAndamentoRef.current = false;
      setEnviando(false);
    }
  }

  const totalEstimado =
    destino === "todos"
      ? clientes.length
      : destino === "individual"
        ? clienteId
          ? 1
          : 0
        : "aniversariantes de hoje";

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <PageHeader
        title="Disparo de mensagens"
        description="Escreva uma ideia, deixe a IA transformar em campanha e envie via WhatsApp."
      />

      <div className="grid lg:grid-cols-[1fr,320px] gap-6">
        <div className="space-y-6">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">1. Modelo & ideia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {modelos.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setTipoModelo(m.tipo)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      tipoModelo === m.tipo
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ideia">Sua ideia (uma frase basta)</Label>
                <Textarea
                  id="ideia"
                  rows={2}
                  placeholder="Ex.: cozinha planejada com condição especial até domingo."
                  value={ideia}
                  onChange={(e) => setIdeia(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => gerar.mutate()}
                disabled={gerar.isPending}
              >
                {gerar.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Gerar mensagem com IA
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">2. Mensagem final</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                rows={10}
                placeholder="A mensagem gerada aparecerá aqui. Você pode editar antes de enviar."
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
              />

              <div className="space-y-2">
                <Label>Foto (opcional)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleSelecionarImagem}
                />
                {imagemUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border p-2">
                    <img
                      src={imagemUrl}
                      alt="Foto da campanha"
                      className="h-16 w-16 rounded-md object-cover"
                    />
                    <div className="flex-1 text-xs text-muted-foreground">
                      Anexada — vai junto com a mensagem para cada destinatário.
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setImagemUrl(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImagem}
                  >
                    {uploadingImagem ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4 mr-2" />
                    )}
                    {uploadingImagem ? "Enviando..." : "Anexar foto"}
                  </Button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {mensagem.length} caracteres
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(mensagem);
                      toast.success("Copiado!");
                    }}
                    disabled={!mensagem}
                  >
                    Copiar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => gerar.mutate()}
                    disabled={gerar.isPending || !ideia}
                  >
                    Gerar novamente
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">3. Destinatários</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Enviar para</Label>
                <Select value={destino} onValueChange={(v) => setDestino(v as typeof destino)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os clientes</SelectItem>
                    <SelectItem value="individual">Cliente específico</SelectItem>
                    <SelectItem value="aniversariantes">Aniversariantes de hoje</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {destino === "individual" && (
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={clienteId} onValueChange={setClienteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome} — {c.telefone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="rounded-lg bg-muted p-3 text-xs">
                <div className="text-muted-foreground">Estimativa</div>
                <div className="font-semibold text-foreground mt-0.5">
                  {typeof totalEstimado === "number"
                    ? `${totalEstimado} destinatário(s)`
                    : totalEstimado}
                </div>
                {typeof totalEstimado === "number" && totalEstimado > 1 && (
                  <div className="text-muted-foreground mt-1">
                    ~{formatarDuracao((totalEstimado - 1) * DELAY_ENTRE_ENVIOS_MS)} de fila
                    ({DELAY_ENTRE_ENVIOS_MS / 1000}s entre cada envio)
                  </div>
                )}
                <div className="text-muted-foreground mt-1">
                  Quem já recebeu essa mesma mensagem é retirado da fila.
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => setConfirmOpen(true)}
                disabled={!mensagem.trim()}
              >
                <Send className="h-4 w-4 mr-2" />
                Enviar campanha
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {!integracaoAtiva ? (
                  <>
                    Nenhuma integração de WhatsApp ativa — configure em{" "}
                    <span className="font-medium">Configurações</span> antes de disparar.
                  </>
                ) : integracaoAtiva.provedor === "mock" ? (
                  <>
                    Provedor WhatsApp em modo <span className="font-medium">simulado</span>.
                    Envios serão registrados no histórico sem chamar API externa.
                  </>
                ) : (
                  <>
                    Enviando por <span className="font-medium">{integracaoAtiva.nome}</span>.
                    {integracaoAtiva.status_conexao !== "conectado" &&
                      " Conexão ainda não confirmada — teste ou leia o QR Code em Configurações."}
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          // não deixa fechar no meio do envio — só antes de começar ou depois de concluído
          if (!v && progresso && !progresso.concluido) return;
          setConfirmOpen(v);
          if (!v) setProgresso(null);
        }}
      >
        <DialogContent className={progresso ? "max-w-lg" : undefined}>
          {!progresso ? (
            <>
              <DialogHeader>
                <DialogTitle>Confirma o envio desta mensagem?</DialogTitle>
              </DialogHeader>
              {imagemUrl && (
                <img
                  src={imagemUrl}
                  alt="Foto da campanha"
                  className="h-32 w-full rounded-md object-cover"
                />
              )}
              <div className="rounded-md bg-muted p-4 text-sm whitespace-pre-wrap max-h-64 overflow-auto">
                {mensagem}
              </div>
              <p className="text-sm text-muted-foreground">
                Destino:{" "}
                <strong>
                  {destino === "todos"
                    ? `Todos os clientes (${clientes.length})`
                    : destino === "individual"
                      ? clientes.find((c) => c.id === clienteId)?.nome ?? "—"
                      : "Aniversariantes de hoje"}
                </strong>
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={() => iniciarEDisparar()} disabled={enviando}>
                  {enviando ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Enviar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {progresso.concluido
                    ? progresso.cancelado
                      ? "Envio cancelado"
                      : "Envio concluído"
                    : "Enviando mensagens..."}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-2">
                <Progress value={(progresso.enviados / progresso.total) * 100} />
                {!progresso.concluido && progresso.enviados < progresso.total && (
                  <p className="text-xs text-muted-foreground">
                    Restam ~
                    {formatarDuracao(
                      (progresso.total - progresso.enviados) * progresso.delayMs,
                    )}{" "}
                    — {progresso.delayMs / 1000}s entre cada envio. Mantenha esta aba aberta.
                  </p>
                )}
                {progresso.jaReceberam > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {progresso.jaReceberam}{" "}
                    {progresso.jaReceberam === 1
                      ? "cliente foi retirado da fila por já ter recebido"
                      : "clientes foram retirados da fila por já terem recebido"}{" "}
                    essa mesma mensagem.
                  </p>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {progresso.enviados} / {progresso.total} processados
                    {providerUsado && ` · ${providerUsado}`}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-success font-medium">
                      <Check className="h-3.5 w-3.5" /> {progresso.sucesso}
                    </span>
                    {progresso.falhas.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-destructive font-medium">
                        <X className="h-3.5 w-3.5" /> {progresso.falhas.length}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {progresso.falhas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-destructive">
                    Falharam ({progresso.falhas.length}):
                  </p>
                  <div className="max-h-48 overflow-auto rounded-md border border-destructive/30 divide-y divide-destructive/20">
                    {progresso.falhas.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 bg-destructive/10 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-destructive truncate">{f.nome}</div>
                          <div className="text-destructive/70">{f.telefone}</div>
                        </div>
                        <div
                          className="text-destructive/80 text-right shrink-0 max-w-[45%] truncate"
                          title={f.erro}
                        >
                          {f.erro}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                {!progresso.concluido ? (
                  <Button
                    variant="outline"
                    onClick={cancelarEnvio}
                    disabled={progresso.cancelado}
                  >
                    {progresso.cancelado ? "Cancelando..." : "Cancelar envio"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setConfirmOpen(false);
                      setProgresso(null);
                    }}
                  >
                    Fechar
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
