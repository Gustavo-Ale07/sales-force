import { matchNeighborhood, matchStreet, normalizeAddressName, registryNameProblem, splitStreetName, type RegistryNameProblem } from '@salesforce/domain';
import type { AppErrorIssue } from '../http/app-error.js';
import type { CustomerUpsertAddress } from './customer-registration-request.js';

/** The ERP address registry as mirrored locally (the server never asks Sankhya, STACK-2). */
export interface AddressRegistry {
  cityExists(code: number): Promise<boolean>;
  neighborhoodExists(code: number): Promise<boolean>;
  streetExists(code: number): Promise<boolean>;
  neighborhoodRegistry(): Promise<{ code: number; name: string }[]>;
  streetRegistry(): Promise<{ code: number; name: string; kind: string | null }[]>;
}

export type AddressResolution =
  | { readonly ok: true; readonly addresses: CustomerUpsertAddress[] }
  | { readonly ok: false; readonly issues: AppErrorIssue[] };

const NAME_PROBLEM_TEXT: Record<RegistryNameProblem, (label: string) => string> = {
  required: (label) => `Informe o nome do ${label}.`,
  too_long: (label) => `O nome do ${label} passa de 60 caracteres.`,
  invalid: (label) => `O nome do ${label} tem caracteres que o ERP não aceita (use letras, números, espaço e . , - / ( ) &).`,
};

/** The refusal the worker would raise later, caught while the user is still on the form (same rule: domain `registryNameProblem`). */
function nameIssue(path: string, label: string, problem: RegistryNameProblem | null): AppErrorIssue | null {
  return problem === null ? null : { path, code: `registry_name_${problem}`, message: NAME_PROBLEM_TEXT[problem](label) };
}

/**
 * P-08: the chosen codes are validated against the mirror before anything is stored, so a made-up or stale code never reaches the
 * worker (classified, actionable error per field). A free street/neighborhood text is matched by name (no accents, no case) against
 * the mirror: a hit becomes the ERP code; a miss stays as text for the worker, which creates it in the Sankhya Sandbox (SNK-3).
 */
export async function resolveAddresses(addresses: readonly CustomerUpsertAddress[], registry: AddressRegistry): Promise<AddressResolution> {
  const issues: AppErrorIssue[] = [];
  const resolved: CustomerUpsertAddress[] = [];
  let neighborhoods: { code: number; name: string }[] | null = null;
  let streets: { code: number; name: string; kind: string | null }[] | null = null;

  for (const [index, address] of addresses.entries()) {
    const at = `addresses.${index}`;
    if (!(await registry.cityExists(address.cityCode))) {
      issues.push({ path: `${at}.cityCode`, code: 'city_not_found', message: 'Cidade não encontrada no cadastro do ERP. Escolha uma cidade da lista.' });
    }
    let { neighborhoodCode, neighborhoodName, streetCode, streetName } = address;

    if (neighborhoodCode > 0) {
      if (!(await registry.neighborhoodExists(neighborhoodCode))) {
        issues.push({ path: `${at}.neighborhoodCode`, code: 'neighborhood_not_found', message: 'Bairro não encontrado no cadastro do ERP. Escolha um bairro da lista ou digite o nome.' });
      }
      neighborhoodName = null;
    } else if (neighborhoodName !== null) {
      const bad = nameIssue(`${at}.neighborhoodName`, 'bairro', registryNameProblem(normalizeAddressName(neighborhoodName)));
      if (bad !== null) issues.push(bad);
      neighborhoods ??= await registry.neighborhoodRegistry();
      const match = matchNeighborhood(neighborhoods, neighborhoodName);
      if (match !== null) {
        neighborhoodCode = match.code;
        neighborhoodName = null;
      }
    }

    if (streetCode > 0) {
      if (!(await registry.streetExists(streetCode))) {
        issues.push({ path: `${at}.streetCode`, code: 'street_not_found', message: 'Logradouro não encontrado no cadastro do ERP. Escolha um logradouro da lista ou digite o nome.' });
      }
      streetName = null;
    } else if (streetName !== null) {
      const bad = nameIssue(`${at}.streetName`, 'logradouro', registryNameProblem(splitStreetName(streetName).name));
      if (bad !== null) issues.push(bad);
      streets ??= await registry.streetRegistry();
      const match = matchStreet(streets, streetName);
      if (match !== null) {
        streetCode = match.code;
        streetName = null;
      }
    }
    resolved.push({ ...address, neighborhoodCode, neighborhoodName, streetCode, streetName });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, addresses: resolved };
}
