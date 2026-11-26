import {
  getCachedPostalCode,
  isoNow,
  putCachedPostalCode,
  searchCities,
  searchNeighborhoods,
  searchStreets,
  type CachedCity,
  type CachedNeighborhood,
  type CachedPostalCode,
  type CachedStreet,
  type OfflineEnv,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import { callApi, type ApiClient } from "../data/api";
import type { CnpjAnswer } from "../data/customer-cnpj";

/** Address helpers of the new-customer form. Searches are local (the lists come with the sync); the CEP lookup uses the server and the local cache. */
export interface AddressPort {
  searchCities(query: string): Promise<readonly CachedCity[]>;
  searchNeighborhoods(query: string): Promise<readonly CachedNeighborhood[]>;
  searchStreets(query: string): Promise<readonly CachedStreet[]>;
  /**
   * The address of an 8-digit CEP: asks the server and remembers an answer that found it; offline, on any failure or when the server does
   * not find it, answers from the local memory, otherwise `null` (the form then simply stays free: no text, no error). Never throws.
   */
  lookupPostalCode(cep: string): Promise<CachedPostalCode | null>;
  /** The company data of a 14-digit CNPJ, asked of the server only (never from the device); `null` when offline, unknown or on any failure. Never throws. */
  lookupCnpj?(cnpj: string): Promise<CnpjAnswer | null>;
}

export function createAddressPort(deps: { readonly db: SqlDatabase; readonly env: OfflineEnv; readonly api: ApiClient }): AddressPort {
  const { db, env, api } = deps;
  return {
    async lookupCnpj(cnpj) {
      if (!/^d{14}$/.test(cnpj)) return null;
      try {
        const answer = await callApi(() => api.GET("/customers/cnpj/{cnpj}", { params: { path: { cnpj } } }));
        return answer.found ? answer : null;
      } catch {
        return null;
      }
    },
    searchCities: (query) => searchCities(db, query),
    searchNeighborhoods: (query) => searchNeighborhoods(db, query),
    searchStreets: (query) => searchStreets(db, query),
    async lookupPostalCode(cep) {
      if (!/^\d{8}$/.test(cep)) return null;
      try {
        const answer = await callApi(() => api.GET("/customers/postal-code/{cep}", { params: { path: { cep } } }));
        if (answer.found) {
          await putCachedPostalCode(db, cep, answer, isoNow(env)).catch(() => undefined);
          return answer;
        }
      } catch {
        // No connection or a failing server: the local memory below.
      }
      return getCachedPostalCode(db, cep).catch(() => null);
    },
  };
}
