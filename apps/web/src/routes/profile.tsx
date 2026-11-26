import { Alert, Button, Card, CardBody, CardHeader, KeyValue, KeyValueList, PageHeader, SkeletonLines } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { ProfilePhotoControls } from "../components/profile-photo-controls";
import { QueryError } from "../components/query-error";
import { useSyncState } from "../components/sync-indicator";
import { APP_VERSION_LABEL } from "../lib/app-version";
import { formatLastSync, type SyncDotColor } from "../lib/sync-indicator";
import { RefreshDataDialog } from "../components/refresh-data-dialog";
import { useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { isOperationsRole } from "../lib/operations-role";

/**
 * "Perfil": read-only view of the signed-in account, from the session the server already returns
 * (`GET /auth/session`). Nothing here is editable: there is no endpoint to change the account, the password or the
 * seller link, and those are administered outside this screen (CFG-2 for the seller link).
 */
/** Text colour of the situation sentence (same states as the header arrows; darker tones for the white card). */
const SITUATION_TEXT: Record<SyncDotColor, string> = { green: "text-[#17693d]", yellow: "text-[#9a5b00]", red: "text-[#d10108]" };

/** "Sincronização" block (same colour table as the header dot) with the "sync now" button. */
function SyncBlock({ role }: { role: string }) {
  const { view, situation, online, dataAsOf, pendingCount, attentionCount, dialogOpen, setDialogOpen } = useSyncState(role);
  return (
    <Card>
      <CardHeader title="Sincronização" />
      <CardBody>
        <p className={`m-0 mb-2 text-sm font-semibold ${SITUATION_TEXT[situation.color]}`}>{situation.text}</p>
        <KeyValueList>
          <KeyValue label="Última sincronização">{formatLastSync(dataAsOf)}</KeyValue>
          {pendingCount > 0 ? <KeyValue label="Alterações pendentes">{pendingCount}</KeyValue> : null}
          {attentionCount > 0 ? <KeyValue label="Pedidos que precisam de atenção">{attentionCount}</KeyValue> : null}
        </KeyValueList>
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={view.spinning || !online} onClick={() => setDialogOpen(true)}>
            {view.spinning ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        </div>
        <RefreshDataDialog open={dialogOpen} role={role} onClose={() => setDialogOpen(false)} />
      </CardBody>
    </Card>
  );
}

export function ProfilePage() {
  const { config, authClient } = useAppServices();
  const query = useQuery(sessionQueryOptions(authClient));

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Perfil" />
        <div aria-busy="true">
          <SkeletonLines lines={5} label="Carregando perfil…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Perfil" />
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o perfil" />
        </Card>
      </>
    );
  }
  const user = query.data;
  if (!user) {
    // The route guard sends anonymous visitors to the login; this only covers a session that ended while the page was open.
    return (
      <>
        <PageHeader title="Perfil" />
        <Alert tone="warning" title="Sessão encerrada">
          Entre novamente para ver o seu perfil.
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={user.name}
        description={user.roleLabel ?? user.role}
      />
      <Card>
        <CardBody>
          <ProfilePhotoControls user={user} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Minha conta" />
        <CardBody>
          <KeyValueList>
            <KeyValue label="Nome">{user.name}</KeyValue>
            <KeyValue label="Usuário">{user.username}</KeyValue>
            <KeyValue label="Perfil">{user.roleLabel ?? user.role}</KeyValue>
          </KeyValueList>
        </CardBody>
      </Card>

      {isOperationsRole(user.role) ? null : <SyncBlock role={user.role} />}
      <Card>
        <CardHeader title="Sobre" />
        <CardBody>
          <KeyValueList>
            <KeyValue label="Aplicativo">Force</KeyValue>
            <KeyValue label="Versão">{APP_VERSION_LABEL}</KeyValue>
            {config.authMode === "dev" ? <KeyValue label="Ambiente">DEV</KeyValue> : null}
          </KeyValueList>
        </CardBody>
      </Card>
    </>
  );
}
