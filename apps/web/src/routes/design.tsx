import {
  Alert,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Combobox,
  DateText,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  DocumentText,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterChip,
  FilterField,
  ForbiddenState,
  FormField,
  IconButton,
  Input,
  KeyValue,
  KeyValueList,
  Money,
  PageHeader,
  Pagination,
  Quantity,
  SearchInput,
  Select,
  Skeleton,
  SkeletonLines,
  SortableHead,
  Spinner,
  StatGrid,
  StatTile,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableLoadingRows,
  TableMessageRow,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  toast,
  type SortDirection,
} from "@salesforce/ui";
import { Download, MoreHorizontal, Plus, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell } from "../components/app-shell";

/* Dev-only kitchen sink. Every value below is synthetic demo data for visual review, never real. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`sec-${title}`} className="flex flex-col gap-2">
      <h2 id={`sec-${title}`} className="m-0 text-sm font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

const demoRows = [
  { code: "1001", name: "Metalúrgica Vale Azul Ltda", doc: "11222333000181", city: "Campinas/SP", status: "Ativo", tone: "success", total: "18450.9", last: "2026-08-14" },
  { code: "1002", name: "Comercial Serra Alta", doc: "12345678909", city: "Joinville/SC", status: "Pendente", tone: "warning", total: "3120", last: "2026-07-02" },
  { code: "1003", name: "Indústria Norte Sul S.A.", doc: "1122233300018", city: "Curitiba/PR", status: "Inativo", tone: "neutral", total: null, last: null },
] as const;

const clientOptions = [
  { value: "1001", label: "Metalúrgica Vale Azul Ltda", description: "Campinas/SP" },
  { value: "1002", label: "Comercial Serra Alta", description: "Joinville/SC" },
  { value: "1003", label: "Indústria Norte Sul S.A.", description: "Curitiba/PR" },
];

/** Route component: the kitchen sink inside the application shell, without a user. */
export function DesignRoute() {
  return (
    <AppShell user={null}>
      <DesignPage />
    </AppShell>
  );
}

function DesignPage() {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [client, setClient] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chips, setChips] = useState(["Ativos", "Campinas"]);
  const [banner, setBanner] = useState(true);
  const toggle = (key: string) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const dir = (key: string) => (sort.key === key ? sort.direction : null);

  return (
    <>
      <PageHeader
        title="Design system"
        description="Todos os componentes de @salesforce/ui com dados de demonstração. Disponível somente em desenvolvimento."
        badges={<StatusBadge tone="info">Somente dev</StatusBadge>}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Download size={14} aria-hidden="true" />}>
              Exportar
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />}>
              Novo
            </Button>
          </>
        }
      />

      <Section title="Botões">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primário</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="danger">Perigo</Button>
            <Button variant="primary" size="sm">
              Pequeno
            </Button>
            <Button variant="primary" size="lg">
              Grande
            </Button>
            <Button variant="primary" loading loadingText="Salvando…">
              Salvar
            </Button>
            <Button variant="secondary" disabled>
              Desabilitado
            </Button>
            <IconButton label="Configurações" icon={<Settings size={15} aria-hidden="true" />} />
          </CardBody>
        </Card>
      </Section>

      <Section title="Status e badges">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Ativo</StatusBadge>
            <StatusBadge tone="warning">Aguardando aprovação</StatusBadge>
            <StatusBadge tone="danger">Rejeitado</StatusBadge>
            <StatusBadge tone="info">Em análise</StatusBadge>
            <StatusBadge tone="neutral">Rascunho</StatusBadge>
            <StatusBadge tone="accent">Novo</StatusBadge>
            <Badge tone="neutral">12</Badge>
            <Avatar name="Ana Souza" />
            <Avatar name="Carlos Lima" size="lg" />
          </CardBody>
        </Card>
      </Section>

      <Section title="Alertas">
        <div className="flex flex-col gap-2">
          <Alert tone="info" title="Informação">
            Mensagem informativa com contexto adicional.
          </Alert>
          <Alert tone="success" title="Pedido enviado" />
          <Alert tone="warning" title="Preço alterado">
            O preço mudou desde a última sincronização.
          </Alert>
          <Alert tone="danger" title="Falha ao salvar">
            Tente novamente em instantes.
          </Alert>
          {banner ? (
            <Banner tone="warning" title="Integração degradada" onDismiss={() => setBanner(false)}>
              Alguns dados podem estar desatualizados.
            </Banner>
          ) : null}
        </div>
      </Section>

      <Section title="Formulário">
        <Card>
          <CardBody className="grid gap-4 md:grid-cols-2">
            <FormField label="Razão social" required hint="Como consta no cadastro.">
              <Input placeholder="Ex.: Comercial Exemplo Ltda" />
            </FormField>
            <FormField label="E-mail" required error="Informe um e-mail válido.">
              <Input type="email" defaultValue="nome@" />
            </FormField>
            <FormField label="Cliente">
              <Combobox
                options={clientOptions}
                value={client}
                onValueChange={setClient}
                placeholder="Buscar cliente"
                emptyText="Nenhum cliente encontrado"
              />
            </FormField>
            <FormField label="Condição de pagamento">
              <Select defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                <option value="30">30 dias</option>
                <option value="30-60">30/60 dias</option>
              </Select>
            </FormField>
            <FormField label="Observações" hint="Visível somente internamente.">
              <Textarea rows={3} />
            </FormField>
            <div className="flex flex-col gap-3">
              <Checkbox label="Receber avisos por e-mail" description="Somente eventos do seu pedido." />
              <Switch label="Ativar alertas" />
              <FormField label="Desabilitado">
                <Input disabled value="Somente leitura" readOnly />
              </FormField>
            </div>
          </CardBody>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="secondary">Cancelar</Button>
            <Button variant="primary">Salvar</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Filtros, tabela e paginação">
        <Card>
          <FilterBar>
            <FilterField label="Busca">
              <SearchInput aria-label="Buscar cliente" value={search} onValueChange={setSearch} placeholder="Nome, código ou CNPJ" />
            </FilterField>
            <FilterField label="Situação">
              <Select aria-label="Situação" defaultValue="">
                <option value="">Todas</option>
                <option value="ativo">Ativo</option>
              </Select>
            </FilterField>
            {chips.map((chip) => (
              <FilterChip key={chip} onRemove={() => setChips((current) => current.filter((c) => c !== chip))}>
                {chip}
              </FilterChip>
            ))}
          </FilterBar>
          <Table label="Clientes de demonstração" maxHeightClassName="max-h-[320px]">
            <TableHeader>
              <tr>
                <SortableHead direction={dir("code")} onSort={() => toggle("code")}>
                  Código
                </SortableHead>
                <SortableHead direction={dir("name")} onSort={() => toggle("name")}>
                  Cliente
                </SortableHead>
                <SortableHead direction={dir("doc")} onSort={() => toggle("doc")}>
                  Documento
                </SortableHead>
                <SortableHead direction={dir("city")} onSort={() => toggle("city")}>
                  Cidade
                </SortableHead>
                <SortableHead numeric direction={dir("total")} onSort={() => toggle("total")}>
                  Último pedido
                </SortableHead>
                <SortableHead numeric direction={dir("last")} onSort={() => toggle("last")}>
                  Data
                </SortableHead>
                <SortableHead direction={dir("status")} onSort={() => toggle("status")}>
                  Situação
                </SortableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {demoRows.map((row) => (
                <TableRow key={row.code} interactive onActivate={() => toast({ title: `Abrir ${row.name}`, tone: "info" })}>
                  <TableCell className="font-mono text-fg-muted">{row.code}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <DocumentText value={row.doc} />
                  </TableCell>
                  <TableCell>{row.city}</TableCell>
                  <TableCell numeric>
                    <Money value={row.total} fallback="Sem preço" />
                  </TableCell>
                  <TableCell numeric>
                    <DateText value={row.last} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={142} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Table label="Carregando">
              <TableHeader>
                <tr>
                  <SortableHead onSort={() => undefined}>Cliente</SortableHead>
                  <SortableHead onSort={() => undefined}>Cidade</SortableHead>
                </tr>
              </TableHeader>
              <TableBody>
                <TableLoadingRows columns={2} rows={3} />
              </TableBody>
            </Table>
          </Card>
          <Card>
            <Table label="Vazia">
              <TableHeader>
                <tr>
                  <SortableHead onSort={() => undefined}>Cliente</SortableHead>
                  <SortableHead onSort={() => undefined}>Cidade</SortableHead>
                </tr>
              </TableHeader>
              <TableBody>
                <TableMessageRow colSpan={2}>
                  <EmptyState compact title="Nenhum cliente encontrado" description="Ajuste os filtros para ver mais resultados." />
                </TableMessageRow>
              </TableBody>
            </Table>
          </Card>
          <Card>
            <Table label="Com erro">
              <TableHeader>
                <tr>
                  <SortableHead onSort={() => undefined}>Cliente</SortableHead>
                  <SortableHead onSort={() => undefined}>Cidade</SortableHead>
                </tr>
              </TableHeader>
              <TableBody>
                <TableMessageRow colSpan={2}>
                  <ErrorState compact onRetry={() => undefined} correlationId="demo-0000" />
                </TableMessageRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      </Section>

      <Section title="Indicadores e valores">
        <StatGrid>
          <StatTile label="Pedidos no mês" value="42" hint="3 aguardando aprovação" />
          <StatTile label="Carteira ativa" value="128" hint="de 156 clientes" progress={82} />
          <StatTile label="Falhas de integração" value="2" emphasis="danger" hint="Reprocessar na tela de integração" />
          <StatTile label="Valor estimado" value={<Money value="18450.9" />} hint="Total estimado, sujeito a revisão" />
        </StatGrid>
        <Card>
          <CardHeader title="Formatos pt-BR" description="Valores decimais chegam como texto do servidor." />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Preço unitário">
                <Money value="12.3456" minFractionDigits={2} maxFractionDigits={6} />
              </KeyValue>
              <KeyValue label="Total">
                <Money value="1234.56" />
              </KeyValue>
              <KeyValue label="Sem preço">
                <Money value={null} fallback="Sem preço" />
              </KeyValue>
              <KeyValue label="Quantidade">
                <Quantity value="1500.5" unit="kg" />
              </KeyValue>
              <KeyValue label="Data e hora">
                <DateText value="2026-09-18T14:30:00Z" withTime />
              </KeyValue>
              <KeyValue label="CNPJ">
                <DocumentText value="11222333000181" />
              </KeyValue>
              <KeyValue label="CPF">
                <DocumentText value="12345678909" />
              </KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
      </Section>

      <Section title="Abas">
        <Card>
          <Tabs defaultValue="geral">
            <TabsList aria-label="Seções do cliente">
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="geral" className="p-3 text-sm">
              Dados cadastrais e condições comerciais.
            </TabsContent>
            <TabsContent value="pedidos" className="p-3 text-sm">
              Pedidos do cliente.
            </TabsContent>
            <TabsContent value="historico" className="p-3 text-sm">
              Linha do tempo de interações.
            </TabsContent>
          </Tabs>
        </Card>
      </Section>

      <Section title="Sobreposições">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Abrir diálogo</Button>
              </DialogTrigger>
              <DialogContent
                title="Enviar pedido?"
                description="O pedido será enviado para aprovação."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="secondary">Cancelar</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="primary" onClick={() => toast({ title: "Pedido enviado", tone: "success" })}>
                        Enviar
                      </Button>
                    </DialogClose>
                  </>
                }
              >
                <p className="m-0 text-sm text-fg-muted">Confira os itens antes de continuar.</p>
              </DialogContent>
            </Dialog>
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="secondary">Abrir painel lateral</Button>
              </DrawerTrigger>
              <DrawerContent side="right" title="Detalhes do item" description="Painel lateral para edição rápida.">
                <p className="m-0 text-sm text-fg-muted">Conteúdo do painel.</p>
              </DrawerContent>
            </Drawer>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Mais ações" icon={<MoreHorizontal size={15} aria-hidden="true" />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Ações</DropdownMenuLabel>
                <DropdownMenuItem>Duplicar</DropdownMenuItem>
                <DropdownMenuItem>Abrir</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive>Excluir rascunho</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip content="Dica contextual">
              <Button variant="ghost">Passe o mouse</Button>
            </Tooltip>
            <Button variant="secondary" onClick={() => toast({ title: "Salvo", description: "Alterações registradas.", tone: "success" })}>
              Disparar toast
            </Button>
            <Button variant="secondary" onClick={() => toast({ title: "Falha ao salvar", description: "Tente novamente.", tone: "danger" })}>
              Toast de erro
            </Button>
          </CardBody>
        </Card>
      </Section>

      <Section title="Estados">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <EmptyState title="Nenhum pedido ainda" description="Crie o primeiro pedido para este cliente." action={<Button variant="primary" size="sm">Novo pedido</Button>} />
          </Card>
          <Card>
            <ErrorState onRetry={() => undefined} correlationId="demo-1234" />
          </Card>
          <Card>
            <ForbiddenState />
          </Card>
        </div>
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner label="Carregando" /> Carregando dados…
            </div>
            <Skeleton className="h-4 w-1/3" />
            <SkeletonLines lines={3} label="Carregando texto" />
          </CardBody>
        </Card>
      </Section>
    </>
  );
}
