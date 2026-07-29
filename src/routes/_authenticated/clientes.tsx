import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Pencil, Trash2, Search, UserPlus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dataDoBanco } from "@/lib/datas";

export const Route = createFileRoute("/_authenticated/clientes")({
  component: ClientesPage,
});

type Cliente = {
  id: string;
  nome: string;
  telefone: string;
  data_nascimento: string;
  cpf: string | null;
  endereco: string | null;
  created_at: string;
};

function formatPhone(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function ClientesPage() {
  const qc = useQueryClient();
  const nomeRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    data_nascimento: "",
    cpf: "",
    endereco: "",
  });
  const [filtro, setFiltro] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Cliente[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório.");
      if (!form.telefone.trim()) throw new Error("Telefone é obrigatório.");
      if (!form.data_nascimento) throw new Error("Data de nascimento é obrigatória.");
      const payload = {
        nome: form.nome.trim(),
        telefone: form.telefone.trim(),
        data_nascimento: form.data_nascimento,
        cpf: form.cpf.trim() || null,
        endereco: form.endereco.trim() || null,
      };
      if (editId) {
        const { error } = await supabase.from("clientes").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clientes").insert(payload);
        if (error) {
          if (error.code === "23505") throw new Error("Este telefone já está cadastrado.");
          throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(editId ? "Cliente atualizado!" : "Cliente cadastrado!");
      setForm({ nome: "", telefone: "", data_nascimento: "", cpf: "", endereco: "" });
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setTimeout(() => nomeRef.current?.focus(), 30);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente removido.");
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = clientes.filter((c) => {
    if (!filtro.trim()) return true;
    const q = filtro.toLowerCase();
    return (
      c.nome.toLowerCase().includes(q) ||
      c.telefone.toLowerCase().includes(q) ||
      (c.cpf ?? "").toLowerCase().includes(q)
    );
  });

  function abrirEdicao(c: Cliente) {
    setEditId(c.id);
    setForm({
      nome: c.nome,
      telefone: c.telefone,
      data_nascimento: c.data_nascimento,
      cpf: c.cpf ?? "",
      endereco: c.endereco ?? "",
    });
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Clientes"
        description="Cadastre em segundos. Nome, telefone e nascimento são obrigatórios."
      />

      <div className="grid lg:grid-cols-[420px,1fr] gap-6">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              {editId ? "Editar cliente" : "Novo cliente"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                salvar.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="nome">Nome *</Label>
                <Input
                  id="nome"
                  ref={nomeRef}
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone *</Label>
                  <Input
                    id="telefone"
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: formatPhone(e.target.value) })}
                    inputMode="tel"
                    placeholder="(11) 99999-0000"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dt">Nascimento *</Label>
                  <Input
                    id="dt"
                    type="date"
                    value={form.data_nascimento}
                    onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpf">CPF (opcional)</Label>
                <Input
                  id="cpf"
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Endereço (opcional)</Label>
                <Input
                  id="end"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={salvar.isPending}>
                  {salvar.isPending ? "Salvando..." : editId ? "Atualizar" : "Cadastrar"}
                </Button>
                {editId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditId(null);
                      setForm({
                        nome: "",
                        telefone: "",
                        data_nascimento: "",
                        cpf: "",
                        endereco: "",
                      });
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Base de clientes{" "}
              <span className="text-muted-foreground font-normal">({filtrados.length})</span>
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar..."
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : filtrados.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhum cliente encontrado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Nascimento</TableHead>
                      <TableHead>Cadastro</TableHead>
                      <TableHead className="w-24 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrados.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.nome}
                          {(c.cpf || c.endereco) && (
                            <div className="text-xs text-muted-foreground">
                              {[c.cpf, c.endereco].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{c.telefone}</TableCell>
                        <TableCell>
                          {format(dataDoBanco(c.data_nascimento), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {format(new Date(c.created_at), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" onClick={() => abrirEdicao(c)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <ConfirmDelete
                              nome={c.nome}
                              onConfirm={() => excluir.mutate(c.id)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ConfirmDelete({ nome, onConfirm }: { nome: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {nome}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esta ação não pode ser desfeita. Todo histórico ligado a este cliente permanecerá,
            mas sem vínculo.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
