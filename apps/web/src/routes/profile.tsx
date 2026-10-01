import { Alert, Avatar, Card, CardBody, CardHeader, KeyValue, KeyValueList, PageHeader, SkeletonLines, titleCase } from "@salesforce/ui";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "../components/query-error";
import { useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";

/**
 * "Meu perfil": read-only view of the signed-in account, from the session the server already returns
 * (`GET /auth/session`). Nothing here is editable: there is no endpoint to change the account, the password or the
 * seller link, and those are administered outside this screen (CFG-2 for the seller link).
 */
export function ProfilePage() {
  const { authClient } = useAppServices();
  const query = useQuery(sessionQueryOptions(authClient));

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Meu perfil" />
        <div aria-busy="true">
          <SkeletonLines lines={5} label="Carregando perfil…" />
        </div>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Meu perfil" />
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
        <PageHeader title="Meu perfil" />
        <Alert tone="warning" title="Sessão encerrada">
          Entre novamente para ver o seu perfil.
        </Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-4">
            <span aria-hidden="true">
              <Avatar name={titleCase(user.name)} seed={user.id} size="xl" />
            </span>
            {user.name}
          </span>
        }
        description={user.roleLabel ?? user.role}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Conta" />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Nome">{user.name}</KeyValue>
              <KeyValue label="E-mail">{user.email}</KeyValue>
              <KeyValue label="Perfil de acesso">{user.roleLabel ?? user.role}</KeyValue>
            </KeyValueList>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Carteira" description="Vendedores vinculados a esta conta na configuração da instalação." />
          <CardBody>
            <KeyValueList>
              <KeyValue label="Vendedores vinculados">
                {user.sellerCodes.length === 0 ? "Nenhum vendedor vinculado" : user.sellerCodes.join(", ")}
              </KeyValue>
            </KeyValueList>
            {user.sellerCodes.length === 0 ? (
              <p className="m-0 mt-2 text-xs text-fg-muted">
                Sem vendedor vinculado, a carteira de clientes e os pedidos ficam fora do seu alcance. Peça o vínculo ao administrador.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
      <p className="m-0 text-xs text-fg-muted">
        Alteração de dados da conta e de senha é feita pelo administrador da instalação; esta tela é somente de consulta.
      </p>
    </>
  );
}
