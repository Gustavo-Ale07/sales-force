import type { ApiSchema } from "@salesforce/contracts/client";
import { Avatar, Button, Select, StatusBadge, TableCell, TableRow, formatDocument, titleCase, toast } from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { customerRegistrationsQueryOptions, queryKeys, sellersQueryOptions } from "../lib/api-queries";
import { setRegistrationSeller } from "../lib/api-mutations";
import { useApi, useAppServices } from "../lib/app-context";
import { sessionQueryOptions } from "../lib/auth-client";
import { describeCustomerWriteError } from "../lib/customer-form";

type Registration = ApiSchema<"CustomerRegistrationView">;

/** Registrations still being delivered to Sankhya (no code yet): `sent` ones already come with the customer list. */
export function usePendingRegistrations(enabled: boolean): Registration[] {
  const api = useApi();
  const query = useQuery({ ...customerRegistrationsQueryOptions(api), enabled });
  return (query.data?.items ?? []).filter((item) => item.sendState === "pending");
}

/** Rows of the customer table for customers saved and not yet in Sankhya: discreet "Envio pendente", "Novo pedido" off until the code arrives. */
export function PendingCustomerRows({ items }: { items: readonly Registration[] }) {
  const api = useApi();
  const { authClient } = useAppServices();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQueryOptions(authClient));
  const manages = session.data?.role === "manager" || session.data?.role === "admin";
  const sellers = useQuery({ ...sellersQueryOptions(api), enabled: manages && items.some((item) => item.sellerCode === null) });
  const activeSellers = (sellers.data?.items ?? []).filter((seller) => seller.active);
  const setSeller = useMutation({
    mutationFn: (input: { registrationId: string; sellerCode: number }) => setRegistrationSeller(api, input.registrationId, input.sellerCode),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.customerRegistrations }),
    onError: (error) => toast({ title: describeCustomerWriteError(error, "Não foi possível definir o vendedor").description, tone: "danger" }),
  });

  return (
    <>
      {items.map((item) => {
        const sellerName = activeSellers.find((seller) => seller.code === item.sellerCode)?.name;
        return (
          <TableRow key={item.registrationId} data-testid="pending-customer">
            <TableCell label="Código" className="text-fg-faint">
              —
            </TableCell>
            <TableCell wrap card="title" className="min-w-[12rem] max-sm:order-first">
              <span className="flex items-center gap-2">
                <Avatar name={titleCase(item.name)} seed={item.registrationId} size="sm" />
                <span className="block font-semibold">{titleCase(item.name)}</span>
              </span>
            </TableCell>
            <TableCell label="Documento">{formatDocument(item.document)}</TableCell>
            <TableCell label="Situação">
              <StatusBadge tone="warning">Envio pendente</StatusBadge>
            </TableCell>
            <TableCell label="Vendedor">
              {item.sellerCode !== null ? (
                (sellerName ?? <span className="text-fg-faint">—</span>)
              ) : manages ? (
                <Select
                  size="sm"
                  aria-label={`Vendedor de ${titleCase(item.name)}`}
                  value=""
                  disabled={sellers.isPending || setSeller.isPending}
                  onChange={(event) => {
                    if (event.target.value !== "") setSeller.mutate({ registrationId: item.registrationId, sellerCode: Number(event.target.value) });
                  }}
                >
                  <option value="">Sem vendedor</option>
                  {activeSellers.map((seller) => (
                    <option key={seller.code} value={String(seller.code)}>
                      {seller.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <StatusBadge tone="warning">Sem vendedor</StatusBadge>
              )}
            </TableCell>
            <TableCell card="hide">
              <span className="text-fg-faint">—</span>
            </TableCell>
            <TableCell card="action">
              <Button size="sm" variant="secondary" disabled aria-label={`Novo pedido para ${titleCase(item.name)}`} leftIcon={<Plus size={12} aria-hidden="true" />}>
                Novo pedido
              </Button>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
