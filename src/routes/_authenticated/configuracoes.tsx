import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Radio, Trash2, Zap, CheckCircle2, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { salvarIntegracao, excluirIntegracao, testarConexao } from "@/lib/integracoes.functions";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: ConfiguracoesPage,
});

type Integracao = {
  id: string;
  nome: string;
  provedor: string;
  url_base: string | null;
  token: string | null;
  numero_remetente: string | null;
  ativo: boolean;
  status_conexao: string;
  ultimo_check: string | null;
  observacoes: string | null;
};

const provedores = [
  { value: "mock", label: "Mock (simulador)", desc: "Registra envios sem chamar API externa." },
  { value: "evolution", label: "Evolution API", desc: "Auto-hospedada. Envia via /message/sendText." },
  { value: "zapi", label: "Z-API", desc: "SaaS brasileiro. Endpoint /send-text." },
  { value: "meta", label: "Meta Cloud API", desc: "WhatsApp Business oficial (Facebook Graph)." },
];

function ConfiguracoesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Integracao | null>(null);

  const { data: integracoes = [], isLoading } = useQuery({
    queryKey: ["integracoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integracoes_whatsapp")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Integracao[];
    },
  });

  const salvarFn = useServerFn(salvarIntegracao);
  const excluirFn = useServerFn(excluirIntegracao);
  const testarFn = useServerFn(testarConexao);

  const excluir = useMutation({
    mutationFn: async (id: string) => excluirFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integracoes"] });
      toast.success("Integração removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testar = useMutation({
    mutationFn: async (id: string) => testarFn({ data: { id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["integracoes"] });
      toast[r.ok ? "success" : "error"](
        r.ok ? `Conexão OK · ${r.detail ?? ""}` : `Falha: ${r.detail ?? "erro"}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader
        title="Configurações · Integrações"
        description="Gerencie os provedores de WhatsApp usados no disparo de mensagens."
        action={
          <Button
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Nova integração
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-4">
          {integracoes.map((i) => (
            <Card key={i.id} className="shadow-card">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                      i.ativo
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Radio className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {i.nome}
                      {i.ativo && (
                        <span className="text-[10px] uppercase font-bold tracking-wider bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                          ativa
                        </span>
                      )}
                    </CardTitle>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Provedor: <span className="font-medium">{i.provedor}</span>
                      {i.numero_remetente && (
                        <> · Remetente: <span className="font-medium">{i.numero_remetente}</span></>
                      )}
                    </div>
                  </div>
                </div>
                <StatusBadge status={i.status_conexao} />
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEdit(i);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testar.mutate(i.id)}
                  disabled={testar.isPending}
                >
                  <Zap className="h-3.5 w-3.5 mr-1.5" /> Testar conexão
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Remover integração "${i.nome}"?`)) excluir.mutate(i.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {i.observacoes && (
                  <p className="text-xs text-muted-foreground w-full mt-2">{i.observacoes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <IntegracaoDialog
        open={open}
        onOpenChange={setOpen}
        initial={edit}
        onSaved={() => {
          setOpen(false);
          qc.invalidateQueries({ queryKey: ["integracoes"] });
        }}
        salvarFn={salvarFn}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    conectado: { label: "Conectado", cls: "bg-success/15 text-success-foreground", Icon: CheckCircle2 },
    simulado: { label: "Simulado", cls: "bg-primary/10 text-primary", Icon: CheckCircle2 },
    erro: { label: "Erro", cls: "bg-destructive/15 text-destructive", Icon: AlertTriangle },
    desconhecido: { label: "Não testado", cls: "bg-muted text-muted-foreground", Icon: AlertTriangle },
  };
  const meta = map[status] ?? map.desconhecido;
  const { Icon } = meta;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${meta.cls}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function IntegracaoDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  salvarFn,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Integracao | null;
  onSaved: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  salvarFn: any;
}) {
  const [form, setForm] = useState({
    nome: "",
    provedor: "mock" as "mock" | "evolution" | "zapi" | "meta",
    url_base: "",
    token: "",
    numero_remetente: "",
    ativo: false,
    observacoes: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        nome: initial?.nome ?? "",
        provedor: (initial?.provedor as never) ?? "mock",
        url_base: initial?.url_base ?? "",
        token: initial?.token ?? "",
        numero_remetente: initial?.numero_remetente ?? "",
        ativo: initial?.ativo ?? false,
        observacoes: initial?.observacoes ?? "",
      });
    }
  }, [open, initial]);

  const salvar = useMutation({
    mutationFn: async () =>
      salvarFn({
        data: { ...form, id: initial?.id },
      }),
    onSuccess: () => {
      toast.success("Integração salva.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar integração" : "Nova integração"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Select
              value={form.provedor}
              onValueChange={(v) => setForm({ ...form, provedor: v as never })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {provedores.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {provedores.find((p) => p.value === form.provedor)?.desc}
            </p>
          </div>
          {form.provedor !== "mock" && (
            <>
              <div className="space-y-2">
                <Label>URL base</Label>
                <Input
                  placeholder={
                    form.provedor === "evolution"
                      ? "https://sua-evolution.com"
                      : form.provedor === "zapi"
                        ? "https://api.z-api.io/instances/XXX/token/YYY"
                        : "https://graph.facebook.com/v20.0"
                  }
                  value={form.url_base}
                  onChange={(e) => setForm({ ...form, url_base: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Token / API Key</Label>
                <Input
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label>
              {form.provedor === "meta"
                ? "Phone Number ID"
                : form.provedor === "evolution"
                  ? "Instância (nome)"
                  : "Número remetente"}
            </Label>
            <Input
              placeholder="27999255959"
              value={form.numero_remetente}
              onChange={(e) => setForm({ ...form, numero_remetente: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              rows={2}
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3 border rounded-md p-3">
            <Switch
              checked={form.ativo}
              onCheckedChange={(v) => setForm({ ...form, ativo: v })}
            />
            <div>
              <div className="text-sm font-medium">Marcar como integração ativa</div>
              <div className="text-xs text-muted-foreground">
                Somente uma integração pode estar ativa por vez.
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
