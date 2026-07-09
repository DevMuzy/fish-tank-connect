import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  MessageSquareText,
  ChevronDown,
  Clock,
  Loader2,
} from "lucide-react";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/historico")({
  component: HistoricoPage,
});

type Campanha = {
  id: string;
  mensagem: string;
  tipo_envio: string;
  quantidade_destinatarios: number;
  status: string;
  sucesso: number;
  erros: number;
  created_at: string;
};

function HistoricoPage() {
  const { data: campanhas = [], isLoading } = useQuery({
    queryKey: ["historico-campanhas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens")
        .select(
          "id, mensagem, tipo_envio, quantidade_destinatarios, status, sucesso, erros, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Campanha[];
    },
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader
        title="Histórico de envios"
        description="Todas as campanhas realizadas, com status detalhado por destinatário."
      />

      {isLoading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : campanhas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma mensagem enviada ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {campanhas.map((c) => (
            <CampanhaCard key={c.id} campanha={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampanhaCard({ campanha: c }: { campanha: Campanha }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="shadow-card">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-accent/20 text-accent-foreground flex items-center justify-center">
            <MessageSquareText className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">
              {c.tipo_envio === "todos"
                ? "Todos os clientes"
                : c.tipo_envio === "individual"
                  ? "Envio individual"
                  : "Aniversariantes"}
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(c.created_at), "dd/MM/yyyy 'às' HH:mm")} ·{" "}
              {c.quantidade_destinatarios} destinatário(s) ·{" "}
              <span className="text-success-foreground">{c.sucesso} ok</span>
              {c.erros > 0 && (
                <> · <span className="text-destructive">{c.erros} falha(s)</span></>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={c.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{c.mensagem}</div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 mr-1.5 transition ${open ? "rotate-180" : ""}`}
          />
          {open ? "Ocultar" : "Ver"} envios individuais
        </Button>
        {open && <EnviosLista mensagemId={c.id} />}
      </CardContent>
    </Card>
  );
}

function EnviosLista({ mensagemId }: { mensagemId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["historico-envios", mensagemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("historico_envios")
        .select(
          "id, telefone, status, tentativas, ultimo_erro, data_envio, atualizado_em, clientes(nome)",
        )
        .eq("mensagem_id", mensagemId)
        .order("data_envio", { ascending: true });
      if (error) throw error;
      return data as Array<{
        id: string;
        telefone: string;
        status: string;
        tentativas: number;
        ultimo_erro: string | null;
        atualizado_em: string;
        clientes: { nome: string } | null;
      }>;
    },
  });

  if (isLoading)
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando envios...
      </div>
    );

  return (
    <div className="border rounded-md divide-y text-xs">
      {data.map((e) => (
        <div key={e.id} className="flex items-center justify-between px-3 py-2 gap-3">
          <div className="min-w-0">
            <div className="font-medium truncate">
              {e.clientes?.nome ?? "—"}{" "}
              <span className="text-muted-foreground font-normal">· {e.telefone}</span>
            </div>
            {e.ultimo_erro && (
              <div className="text-destructive truncate">{e.ultimo_erro}</div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-muted-foreground">{e.tentativas}× tentativa(s)</span>
            <EnvioStatus status={e.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EnvioStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    aguardando: { label: "Aguardando", cls: "bg-muted text-muted-foreground" },
    enviando: { label: "Enviando", cls: "bg-primary/10 text-primary" },
    enviado: { label: "Enviado", cls: "bg-success/15 text-success-foreground" },
    falhou: { label: "Falhou", cls: "bg-destructive/15 text-destructive" },
  };
  const meta = map[status] ?? map.aguardando;
  return (
    <span className={`px-2 py-0.5 rounded-full font-semibold ${meta.cls}`}>{meta.label}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    concluido: { label: "Concluído", cls: "bg-success/15 text-success-foreground", Icon: CheckCircle2 },
    parcial: { label: "Parcial", cls: "bg-warning/15 text-warning-foreground", Icon: Clock },
    processando: { label: "Processando", cls: "bg-primary/10 text-primary", Icon: Loader2 },
    falhou: { label: "Falhou", cls: "bg-destructive/15 text-destructive", Icon: XCircle },
  };
  const meta = map[status] ?? map.falhou;
  const { Icon } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${meta.cls}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}
