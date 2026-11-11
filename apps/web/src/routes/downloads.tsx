import { Badge, Card, CardBody, EmptyState, ErrorState, PageHeader, SkeletonLines, buttonVariants } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Smartphone, Star } from "lucide-react";
import { formatSize, loadDownloads, type DownloadItem } from "../lib/downloads";

const INSTALL_STEPS = [
  "Abra esta página no celular e toque em “Baixar para Android”.",
  "Ao abrir o arquivo, permita a instalação de apps desta origem quando o Android pedir.",
  "Confira o SHA-256 acima se o seu administrador pedir. O app também se atualiza sozinho depois de instalado.",
] as const;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function DownloadCard({ item, newest }: { item: DownloadItem; newest: boolean }) {
  const published = formatDate(item.publishedAt);
  return (
    <Card className={newest ? "border-accent ring-1 ring-accent/30" : undefined}>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${newest ? "bg-accent-weak text-accent-text" : "bg-surface-3 text-fg-muted"}`}
          >
            <Smartphone size={20} />
          </span>
          <h2 className="text-base font-semibold">{item.label}</h2>
          {newest ? (
            <Badge tone="success" className="gap-1">
              <Star size={11} aria-hidden="true" />
              Versão atual
            </Badge>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-fg-muted">Versão</dt>
            <dd>
              {item.versionName} ({item.versionCode})
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Tamanho</dt>
            <dd>{formatSize(item.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Canal</dt>
            <dd>{item.channel}</dd>
          </div>
          {published ? (
            <div>
              <dt className="text-fg-muted">Publicado em</dt>
              <dd>{published}</dd>
            </div>
          ) : null}
        </dl>
        {item.notes ? <p className="text-sm text-fg-muted">{item.notes}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <a className={buttonVariants({ variant: newest ? "primary" : "secondary", size: newest ? "lg" : "md" })} href={item.url} download>
            <Download size={16} aria-hidden="true" />
            Baixar para Android
          </a>
        </div>
        <p className="break-all text-xs text-fg-muted">
          SHA-256: <code>{item.sha256}</code>
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * "Aplicativo": downloads center (public on purpose, so a phone can open it without signing in). The list comes
 * from `downloads.json` (configuration published with the files); nothing here is a literal.
 */
export function DownloadsPage() {
  const query = useQuery({ queryKey: ["downloads-index"], queryFn: () => loadDownloads(), retry: false });
  return (
    <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="Aplicativo" description="Instale o aplicativo Force no celular Android. O arquivo só deve ser baixado por este endereço." />
      {query.isPending ? (
        <div aria-busy="true">
          <SkeletonLines lines={4} label="Carregando downloads…" />
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState title="Não foi possível carregar a lista de downloads" onRetry={() => void query.refetch()} retrying={query.isRefetching} />
        </Card>
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma versão disponível ainda" description="O aplicativo Android será publicado aqui. Volte em breve." />
        </Card>
      ) : (
        query.data.map((item, index) => <DownloadCard key={item.id} item={item} newest={index === 0} />)
      )}
      <Card>
        <CardBody className="text-sm text-fg-muted">
          <p className="mb-3 font-semibold text-fg">Como instalar</p>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {INSTALL_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-weak text-xs font-semibold text-accent-text"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
      <p className="text-sm">
        <Link to="/" className="text-cta-text underline">
          Voltar ao início
        </Link>
      </p>
    </main>
  );
}
