import { Inject, Injectable } from '@nestjs/common';
import type { CnpjLookup } from '@salesforce/contracts';
import { cnpjLookupCache, type Database } from '@salesforce/db';
import { isValidCnpj } from '@salesforce/domain';
import { eq } from 'drizzle-orm';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CLOCK, CNPJ_SOURCES, DATABASE, type Clock } from '../platform/tokens.js';
import type { CnpjSource, CnpjSourceName, ExternalCompany } from './cnpj.source.js';

/** Per-source timeout. */
export const CNPJ_SOURCE_TIMEOUT_MS = 3_000;
/** Persistent cache of a found company (owner request: 30 days). */
export const CNPJ_CACHE_TTL_MS = 30 * 24 * 3_600_000;
/** Per-user budget (the endpoint reaches third parties): 20 lookups per minute, then 429 `rate_limited`. */
const USER_LIMIT = 20;
const USER_WINDOW_MS = 60_000;
const THROTTLE_USERS_LIMIT = 2_000;

export interface CachedCompany {
  readonly company: ExternalCompany;
  readonly source: CnpjSourceName;
  readonly fetchedAt: Date;
}

/** Persistent store of the lookups. Failures of the store never fail a lookup. */
export interface CnpjCacheStore {
  get(cnpj: string): Promise<CachedCompany | null>;
  put(cnpj: string, entry: CachedCompany): Promise<void>;
}

@Injectable()
export class DbCnpjCacheStore implements CnpjCacheStore {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(cnpj: string): Promise<CachedCompany | null> {
    const [row] = await this.db.select().from(cnpjLookupCache).where(eq(cnpjLookupCache.cnpj, cnpj)).limit(1);
    if (row === undefined) return null;
    return { company: row.payload as ExternalCompany, source: row.source as CnpjSourceName, fetchedAt: row.fetchedAt };
  }

  async put(cnpj: string, entry: CachedCompany): Promise<void> {
    const values = { cnpj, payload: entry.company, source: entry.source, fetchedAt: entry.fetchedAt };
    await this.db
      .insert(cnpjLookupCache)
      .values(values)
      .onConflictDoUpdate({ target: cnpjLookupCache.cnpj, set: { payload: values.payload, source: values.source, fetchedAt: values.fetchedAt } });
  }
}

export const CNPJ_CACHE_STORE = Symbol('CNPJ_CACHE_STORE');

const NOT_FOUND: CnpjLookup = {
  found: false,
  cnpj: null,
  legalName: null,
  tradeName: null,
  postalCode: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: null,
  uf: null,
  phone: null,
  email: null,
  source: null,
};

type Answer = { readonly company: ExternalCompany; readonly source: CnpjSourceName } | null;

/**
 * CNPJ lookup for the legal-entity registration. Invalid, unknown or unreachable CNPJ all answer "not found": it is a convenience,
 * never a reason for a screen error. Only the 14 digits reach the external sources; neither the digits nor the answer are logged.
 * A found company is kept for 30 days (persistent); simultaneous lookups of the same CNPJ share one round of external calls.
 */
@Injectable()
export class CnpjService {
  readonly #inflight = new Map<string, Promise<Answer>>();
  readonly #hits = new Map<string, number[]>();

  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CNPJ_CACHE_STORE) private readonly cache: CnpjCacheStore,
    @Inject(CNPJ_SOURCES) private readonly sources: readonly CnpjSource[],
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async lookup(user: CurrentUser, rawCnpj: string): Promise<CnpjLookup> {
    // Same gate as the registration endpoints.
    await this.policy.accessContext(user);
    this.throttle(user.accountId);
    const cnpj = rawCnpj.replace(/[\s./-]/g, '');
    if (!/^\d{14}$/.test(cnpj) || !isValidCnpj(cnpj)) return NOT_FOUND;
    const answer = await this.shared(cnpj);
    if (answer === null) return NOT_FOUND;
    const c = answer.company;
    return {
      found: true,
      cnpj,
      legalName: c.legalName,
      tradeName: c.tradeName,
      postalCode: c.postalCode,
      street: c.street,
      number: c.number,
      complement: c.complement,
      neighborhood: c.neighborhood,
      city: c.city,
      uf: c.uf,
      phone: c.phone,
      email: c.email,
      source: answer.source,
    };
  }

  private throttle(accountId: string): void {
    const now = this.clock().getTime();
    const recent = (this.#hits.get(accountId) ?? []).filter((at) => now - at < USER_WINDOW_MS);
    if (recent.length >= USER_LIMIT) {
      this.#hits.set(accountId, recent);
      const wait = Math.max(1, Math.ceil((USER_WINDOW_MS - (now - (recent[0] ?? now))) / 1_000));
      throw new AppError('rate_limited', { retryAfterSeconds: wait });
    }
    recent.push(now);
    if (!this.#hits.has(accountId) && this.#hits.size >= THROTTLE_USERS_LIMIT) {
      const oldest = this.#hits.keys().next();
      if (!oldest.done) this.#hits.delete(oldest.value);
    }
    this.#hits.set(accountId, recent);
  }

  private shared(cnpj: string): Promise<Answer> {
    const running = this.#inflight.get(cnpj);
    if (running !== undefined) return running;
    const started = this.resolve(cnpj).finally(() => {
      this.#inflight.delete(cnpj);
    });
    this.#inflight.set(cnpj, started);
    return started;
  }

  private async resolve(cnpj: string): Promise<Answer> {
    const now = this.clock();
    try {
      const cached = await this.cache.get(cnpj);
      if (cached !== null && now.getTime() - cached.fetchedAt.getTime() < CNPJ_CACHE_TTL_MS) {
        return { company: cached.company, source: cached.source };
      }
    } catch {
      // A failing cache is a miss, never an error.
    }
    for (const source of this.sources) {
      try {
        const found = await source.lookup(cnpj, AbortSignal.timeout(CNPJ_SOURCE_TIMEOUT_MS));
        if (found !== null) {
          await this.cache.put(cnpj, { company: found, source: source.name, fetchedAt: now }).catch(() => undefined);
          return { company: found, source: source.name };
        }
      } catch {
        // Unreachable, slow or garbled source: try the next one. Never surfaced, never logged with the CNPJ.
      }
    }
    return null;
  }
}
