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

type FalhaItem = { nome: string; telefone: string; erro: string };
type Progresso = {
  total: number;
  enviados: number;
  sucesso: number;
  falhas: FalhaItem[];
  concluido: boolean;
  cancelado: boolean;
};

export const Route = createFileRoute("/_authenticated/mensagens")({
  component: MensagensPage,
});

const modelos = [
  { id: "livre", label: "✍️ Livre", tipo: "livre" as const },
  { id: "promo", label: "🐟 Promoção", tipo: "promocao" as const },
  { id: "novo", label: "🦐 Produto novo", tipo: "produto_novo" as const },
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
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
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
    if (!mensagem.trim()) return toast.error("Escreva ou gere uma mensagem antes de enviar.");
    if (destino === "individual" && !clienteId)
      return toast.error("Selecione um cliente destinatário.");

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
        });

        const isUltimo = i === r.fila.length - 1;
        if (r.aplicarDelay && !isUltimo && !cancelarRef.current) {
          const ms = r.delayMinMs + Math.random() * (r.delayMaxMs - r.delayMinMs);
          await new Promise((res) => setTimeout(res, ms));
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
      toast.success(
        cancelarRef.current
          ? `Envio cancelado — ${sucesso}/${r.fila.length} entregues`
          : `Envio concluído: ${sucesso}/${r.fila.length} entregues`,
      );
      setMensagem("");
      setIdeia("");
      setImagemUrl(null);
    } catch (e) {
      toast.error((e as Error).message);
      setConfirmOpen(false);
    } finally {
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
                  placeholder="Ex.: salmão com desconto até domingo."
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
                Provedor WhatsApp em modo <span className="font-medium">simulado</span>.
                Envios serão registrados no histórico sem chamar API externa.
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
