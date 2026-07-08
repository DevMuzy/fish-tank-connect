import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, XCircle, MessageSquareText } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/historico")({
  component: HistoricoPage,
});

function HistoricoPage() {
  const { data: campanhas = [], isLoading } = useQuery({
    queryKey: ["historico-campanhas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens")
        .select("id, mensagem, tipo_envio, quantidade_destinatarios, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader
        title="Histórico de envios"
        description="Todas as campanhas realizadas, com status e destinatários."
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
            <Card key={c.id} className="shadow-card">
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
                      {c.quantidade_destinatarios} destinatário(s)
                    </div>
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                  {c.mensagem}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === "concluido";
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
        ok
          ? "bg-success/15 text-success-foreground"
          : "bg-destructive/15 text-destructive"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {ok ? "Concluído" : status === "parcial" ? "Parcial" : "Falhou"}
    </span>
  );
}
