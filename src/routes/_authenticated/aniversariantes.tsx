import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Cake } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/aniversariantes")({
  component: AnivPage,
});

type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  data_nascimento: string;
};

function AnivPage() {
  const { data } = useQuery({
    queryKey: ["aniversariantes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, telefone, data_nascimento");
      if (error) throw error;
      return data as Cliente[];
    },
  });

  const now = new Date();
  const start = startOfDay(now);
  const mm = now.getMonth() + 1;
  const dd = now.getDate();

  const hoje: Cliente[] = [];
  const semana: Array<Cliente & { dias: number }> = [];
  const mes: Array<Cliente & { dia: number }> = [];
  const proximos: Array<Cliente & { dias: number }> = [];

  (data ?? []).forEach((c) => {
    const d = new Date(c.data_nascimento);
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (m === mm && day === dd) hoje.push(c);
    if (m === mm) mes.push({ ...c, dia: day });
    const proxima = new Date(now.getFullYear(), m - 1, day);
    if (proxima < start) proxima.setFullYear(now.getFullYear() + 1);
    const diff = Math.round((proxima.getTime() - start.getTime()) / 86400000);
    if (diff >= 0 && diff <= 7) semana.push({ ...c, dias: diff });
    if (diff >= 0 && diff <= 30) proximos.push({ ...c, dias: diff });
  });
  semana.sort((a, b) => a.dias - b.dias);
  proximos.sort((a, b) => a.dias - b.dias);
  mes.sort((a, b) => a.dia - b.dia);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <PageHeader
        title="Aniversariantes"
        description="Organize campanhas especiais para a data mais importante do seu cliente."
      />

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Hoje" value={hoje.length} highlight />
        <StatCard label="Próximos 7 dias" value={semana.length} />
        <StatCard label="Este mês" value={mes.length} />
      </div>

      <Tabs defaultValue="proximos">
        <TabsList>
          <TabsTrigger value="hoje">Hoje</TabsTrigger>
          <TabsTrigger value="proximos">Próximos 7 dias</TabsTrigger>
          <TabsTrigger value="mes">Este mês</TabsTrigger>
        </TabsList>

        <TabsContent value="hoje">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aniversariantes de hoje</CardTitle>
            </CardHeader>
            <CardContent>
              {hoje.length === 0 ? (
                <Empty text="Nenhum aniversariante hoje." />
              ) : (
                <List
                  items={hoje.map((c) => ({
                    id: c.id,
                    nome: c.nome,
                    telefone: c.telefone,
                    right: "Hoje 🎉",
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proximos">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Próximos aniversariantes (7 dias)</CardTitle>
            </CardHeader>
            <CardContent>
              {semana.length === 0 ? (
                <Empty text="Nenhum aniversariante nos próximos 7 dias." />
              ) : (
                <List
                  items={semana.map((c) => ({
                    id: c.id,
                    nome: c.nome,
                    telefone: c.telefone,
                    sub: format(new Date(c.data_nascimento), "dd 'de' MMMM", { locale: ptBR }),
                    right: c.dias === 0 ? "Hoje" : `em ${c.dias} dia${c.dias > 1 ? "s" : ""}`,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mes">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aniversariantes deste mês</CardTitle>
            </CardHeader>
            <CardContent>
              {mes.length === 0 ? (
                <Empty text="Nenhum aniversariante este mês." />
              ) : (
                <List
                  items={mes.map((c) => ({
                    id: c.id,
                    nome: c.nome,
                    telefone: c.telefone,
                    right: `Dia ${String(c.dia).padStart(2, "0")}`,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : ""}>
      <CardContent className="pt-6 flex items-center gap-4">
        <div
          className={`h-12 w-12 rounded-xl flex items-center justify-center ${
            highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
          }`}
        >
          <Cake className="h-6 w-6" />
        </div>
        <div>
          <div className="text-3xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-8 text-center">{text}</p>;
}

function List({
  items,
}: {
  items: Array<{ id: string; nome: string; telefone: string; sub?: string; right: string }>;
}) {
  return (
    <ul className="divide-y">
      {items.map((c) => (
        <li key={c.id} className="py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium">{c.nome}</div>
            <div className="text-xs text-muted-foreground">
              {c.telefone}
              {c.sub && ` · ${c.sub}`}
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/20 text-accent-foreground shrink-0">
            {c.right}
          </span>
        </li>
      ))}
    </ul>
  );
}
