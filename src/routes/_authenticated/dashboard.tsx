import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, UserPlus, MessageSquareText, Cake, Send, CalendarDays } from "lucide-react";
import { format, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const hoje = startOfDay(new Date()).toISOString();
      const mes = startOfMonth(new Date()).toISOString();

      const [clientes, hojeCount, mesCount, msgsCount, ultimoDisp, ultimosClientes] =
        await Promise.all([
          supabase.from("clientes").select("*", { count: "exact", head: true }),
          supabase.from("clientes").select("*", { count: "exact", head: true }).gte("created_at", hoje),
          supabase.from("clientes").select("*", { count: "exact", head: true }).gte("created_at", mes),
          supabase.from("historico_envios").select("*", { count: "exact", head: true }),
          supabase
            .from("mensagens")
            .select("id, mensagem, tipo_envio, quantidade_destinatarios, created_at")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("clientes")
            .select("id, nome, telefone, created_at")
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

      const { data: allClientes } = await supabase
        .from("clientes")
        .select("id, nome, telefone, data_nascimento");

      const now = new Date();
      const mmHoje = now.getMonth() + 1;
      const ddHoje = now.getDate();
      const anivHoje: typeof allClientes = [];
      const anivProximos: Array<{
        id: string;
        nome: string;
        telefone: string;
        data_nascimento: string;
        dias: number;
      }> = [];

      (allClientes || []).forEach((c) => {
        const d = new Date(c.data_nascimento);
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        if (m === mmHoje && day === ddHoje) anivHoje.push(c);
        const proxima = new Date(now.getFullYear(), m - 1, day);
        if (proxima < startOfDay(now)) proxima.setFullYear(now.getFullYear() + 1);
        const diff = Math.round((proxima.getTime() - startOfDay(now).getTime()) / 86400000);
        if (diff >= 0 && diff <= 7) {
          anivProximos.push({ ...c, dias: diff });
        }
      });
      anivProximos.sort((a, b) => a.dias - b.dias);

      return {
        total: clientes.count ?? 0,
        hoje: hojeCount.count ?? 0,
        mes: mesCount.count ?? 0,
        msgs: msgsCount.count ?? 0,
        ultimoDisparo: ultimoDisp.data?.[0] ?? null,
        ultimosClientes: ultimosClientes.data ?? [],
        anivHoje: anivHoje ?? [],
        anivProximos: anivProximos.slice(0, 6),
        ultimosDisparos: ultimoDisp.data ?? [],
      };
    },
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Dashboard"
        description="Visão geral da sua base de clientes e campanhas."
        action={
          <Button asChild size="lg">
            <Link to="/clientes">
              <UserPlus className="h-5 w-5 mr-2" />
              Cadastrar cliente
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<Users className="h-5 w-5" />}
              label="Total de clientes"
              value={data?.total ?? 0}
              tone="primary"
            />
            <MetricCard
              icon={<UserPlus className="h-5 w-5" />}
              label="Cadastros hoje"
              value={data?.hoje ?? 0}
              tone="accent"
            />
            <MetricCard
              icon={<CalendarDays className="h-5 w-5" />}
              label="Cadastros no mês"
              value={data?.mes ?? 0}
              tone="muted"
            />
            <MetricCard
              icon={<MessageSquareText className="h-5 w-5" />}
              label="Mensagens enviadas"
              value={data?.msgs ?? 0}
              tone="muted"
            />
            <MetricCard
              icon={<Cake className="h-5 w-5" />}
              label="Aniversariantes hoje"
              value={data?.anivHoje.length ?? 0}
              tone="accent"
            />
            <MetricCard
              icon={<Cake className="h-5 w-5" />}
              label="Próximos 7 dias"
              value={data?.anivProximos.length ?? 0}
              tone="muted"
            />
            <MetricCard
              icon={<Send className="h-5 w-5" />}
              label="Último disparo"
              value={
                data?.ultimoDisparo
                  ? format(new Date(data.ultimoDisparo.created_at), "dd/MM HH:mm")
                  : "—"
              }
              tone="muted"
              small
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-6 mt-8">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Últimos clientes cadastrados</CardTitle>
              </CardHeader>
              <CardContent>
                {data?.ultimosClientes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum cliente ainda.</p>
                ) : (
                  <ul className="divide-y">
                    {data?.ultimosClientes.map((c) => (
                      <li key={c.id} className="py-3 flex items-center justify-between">
                        <div>
                          <div className="font-medium">{c.nome}</div>
                          <div className="text-xs text-muted-foreground">{c.telefone}</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(c.created_at), "dd/MM/yyyy HH:mm")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Próximos aniversariantes</CardTitle>
              </CardHeader>
              <CardContent>
                {(!data?.anivProximos || data.anivProximos.length === 0) ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum aniversariante nos próximos 7 dias.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {data.anivProximos.map((c) => (
                      <li key={c.id} className="flex items-center justify-between text-sm">
                        <div>
                          <div className="font-medium">{c.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(c.data_nascimento), "dd 'de' MMMM", { locale: ptBR })}
                          </div>
                        </div>
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-accent/20 text-accent-foreground">
                          {c.dias === 0 ? "Hoje" : `em ${c.dias}d`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Últimos disparos realizados</CardTitle>
            </CardHeader>
            <CardContent>
              {(!data?.ultimosDisparos || data.ultimosDisparos.length === 0) ? (
                <p className="text-sm text-muted-foreground">Nenhum disparo ainda.</p>
              ) : (
                <ul className="divide-y">
                  {data.ultimosDisparos.map((m) => (
                    <li key={m.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm truncate max-w-xl">{m.mensagem}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {m.tipo_envio === "todos"
                            ? "Todos os clientes"
                            : m.tipo_envio === "individual"
                              ? "Individual"
                              : "Aniversariantes"}
                          {" · "}
                          {m.quantidade_destinatarios} destinatário(s)
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(m.created_at), "dd/MM HH:mm")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: "primary" | "accent" | "muted";
  small?: boolean;
}) {
  const toneCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground"
      : tone === "accent"
        ? "bg-accent text-accent-foreground"
        : "bg-secondary text-secondary-foreground";
  return (
    <Card className="shadow-soft">
      <CardContent className="pt-6">
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${toneCls}`}>
          {icon}
        </div>
        <div className={`mt-4 font-bold ${small ? "text-lg" : "text-3xl"}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
