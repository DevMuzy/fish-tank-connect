import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useServerFn } from "@tanstack/react-query";
import { useServerFn as tsrUseServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Send, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { enviarCampanha } from "@/lib/messages.functions";

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
  const enviarFn = tsrUseServerFn(enviarCampanha);

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

  const enviar = useMutation({
    mutationFn: async () => {
      if (!mensagem.trim()) throw new Error("Escreva ou gere uma mensagem antes de enviar.");
      if (destino === "individual" && !clienteId)
        throw new Error("Selecione um cliente destinatário.");
      return await enviarFn({
        data: {
          mensagem: mensagem.trim(),
          tipo_envio: destino,
          cliente_id: destino === "individual" ? clienteId : null,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(
        `Enviado! ${r.sucesso}/${r.total} entregues (provedor: ${r.provider})`,
      );
      setConfirmOpen(false);
      setMensagem("");
      setIdeia("");
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
    },
  });

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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirma o envio desta mensagem?</DialogTitle>
          </DialogHeader>
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
            <Button onClick={() => enviar.mutate()} disabled={enviar.isPending}>
              {enviar.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
