import { Inject, Injectable } from '@nestjs/common';
import type { PostalCodeLookup } from '@salesforce/contracts';
import { matchCity, matchNeighborhood, matchStreet } from '@salesforce/domain';
import { PolicyService } from '../iam/policy.service.js';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { CLOCK, POSTAL_CODE_SOURCES, type Clock } from '../platform/tokens.js';
import type { ExternalAddress, PostalCodeSource } from './postal-code.source.js';

/** Per-source timeout (owner request: about 2 s each). */
export const POSTAL_CODE_SOURCE_TIMEOUT_MS = 2_000;
const FOUND_TTL_MS = 24 * 3_600_000;
const NOT_FOUND_TTL_MS = 30 * 60_000;
const CACHE_LIMIT = 500;
/** Per-user budget (the endpoint reaches third parties): 30 lookups per minute, then 429 `rate_limited`. */
const USER_LIMIT = 30;
const USER_WINDOW_MS = 60_000;
const THROTTLE_USERS_LIMIT = 2_000;
/** The mirrored registry lists change a few times a day: a short in-memory copy spares reading them on every lookup. */
const REGISTRY_TTL_MS = 60_000;

interface Cached<T> {
  readonly until: number;
  readonly value: Promise<T>;
}

const NOT_FOUND: PostalCodeLookup = {
  found: false,
  postalCode: null,
  street: null,
  neighborhood: null,
  city: null,
  uf: null,
  cityCode: null,
  neighborhoodCode: null,
  streetCode: null,
  source: null,
};

interface CacheEntry {
  readonly until: number;
  readonly address: { readonly value: ExternalAddress; readonly source: 'viacep' | 'brasilapi' } | null;
}

/**
 * Postal-code lookup for the customer registration. External failure, timeout, unknown or malformed CEP all answer
 * "not found": it is a convenience, never a reason for a screen error. Only the 8 CEP digits reach the external sources.
 * The ERP postal-code table (TSICEP, mirrored) answers first, with its own codes; only when it does not know the CEP do the
 * external sources run: ViaCEP, then BrasilAPI.
 * The external text is then matched against the mirrored ERP registry (city by IBGE + UF, else name + UF; neighborhood and
 * street by name without accents or case); a match adds the ERP code, otherwise only the text is returned.
 */
@Injectable()
export class PostalCodeService {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, Promise<{ value: ExternalAddress; source: 'viacep' | 'brasilapi' } | null>>();
  readonly #hits = new Map<string, number[]>();
  #cities: Cached<Awaited<ReturnType<MirrorRepository['listCities']>>> | null = null;
  #neighborhoods: Cached<Awaited<ReturnType<MirrorRepository['listNeighborhoods']>>> | null = null;
  #streets: Cached<Awaited<ReturnType<MirrorRepository['listStreets']>>> | null = null;

  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(POSTAL_CODE_SOURCES) private readonly sources: readonly PostalCodeSource[],
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async lookup(user: CurrentUser, rawCep: string): Promise<PostalCodeLookup> {
    // Same gate as the registration endpoints: a seller without a valid link, or a profile that may not register, is refused.
    await this.policy.accessContext(user);
    this.throttle(user.accountId);
    return this.resolveCep(rawCep);
  }

  /** Spreadsheet import: the same lookup without the per-call budget (the import is capped at 30 rows and checks the access gate once). */
  async lookupForImport(user: CurrentUser, rawCep: string): Promise<PostalCodeLookup> {
    await this.policy.accessContext(user);
    return this.resolveCep(rawCep);
  }

  private async resolveCep(rawCep: string): Promise<PostalCodeLookup> {
    const cep = rawCep.replace(/[\s.-]/g, '');
    if (!/^\d{8}$/.test(cep) || /^0{8}$/.test(cep)) return NOT_FOUND;

    const own = await this.mirror.findPostalCode(cep);
    if (own !== null) {
      return {
        found: true,
        postalCode: cep,
        street: own.street,
        neighborhood: own.neighborhood,
        city: own.city,
        uf: own.uf,
        cityCode: own.cityCode,
        neighborhoodCode: own.neighborhoodCode,
        streetCode: own.streetCode,
        source: 'erp',
      };
    }

    const external = await this.fromSources(cep);
    if (external === null) return NOT_FOUND;
    const { value, source } = external;

    const [cities, neighborhoods, streets] = await Promise.all([
      this.cities(),
      value.neighborhood === null ? Promise.resolve([]) : this.neighborhoods(),
      value.street === null ? Promise.resolve([]) : this.streets(),
    ]);
    const city = matchCity(cities, { name: value.city, uf: value.uf, ibge: value.ibge });
    const neighborhood = value.neighborhood === null ? null : matchNeighborhood(neighborhoods, value.neighborhood);
    const street = value.street === null ? null : matchStreet(streets, value.street);
    return {
      found: true,
      postalCode: cep,
      street: value.street,
      neighborhood: value.neighborhood,
      city: value.city,
      uf: value.uf,
      cityCode: city?.code ?? null,
      neighborhoodCode: neighborhood?.code ?? null,
      streetCode: street?.code ?? null,
      source,
    };
  }

  /** Sliding window per account; throws `rate_limited` (429 with Retry-After) past the budget. */
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

  private cities() {
    const now = this.clock().getTime();
    if (this.#cities !== null && this.#cities.until > now) return this.#cities.value;
    const value = this.mirror.listCities();
    const slot = { until: now + REGISTRY_TTL_MS, value };
    this.#cities = slot;
    // A failed read is not kept: the next lookup reads again.
    value.catch(() => { if (this.#cities === slot) this.#cities = null; });
    return value;
  }

  private neighborhoods() {
    const now = this.clock().getTime();
    if (this.#neighborhoods !== null && this.#neighborhoods.until > now) return this.#neighborhoods.value;
    const value = this.mirror.listNeighborhoods();
    const slot = { until: now + REGISTRY_TTL_MS, value };
    this.#neighborhoods = slot;
    value.catch(() => { if (this.#neighborhoods === slot) this.#neighborhoods = null; });
    return value;
  }

  private streets() {
    const now = this.clock().getTime();
    if (this.#streets !== null && this.#streets.until > now) return this.#streets.value;
    const value = this.mirror.listStreets();
    const slot = { until: now + REGISTRY_TTL_MS, value };
    this.#streets = slot;
    value.catch(() => { if (this.#streets === slot) this.#streets = null; });
    return value;
  }

  /** Simultaneous lookups of the same CEP share one round of external calls. */
  private fromSources(cep: string): Promise<{ value: ExternalAddress; source: 'viacep' | 'brasilapi' } | null> {
    const running = this.#inflight.get(cep);
    if (running !== undefined) return running;
    const started = this.queryExternal(cep).finally(() => {
      this.#inflight.delete(cep);
    });
    this.#inflight.set(cep, started);
    return started;
  }

  private async queryExternal(cep: string): Promise<{ value: ExternalAddress; source: 'viacep' | 'brasilapi' } | null> {
    const now = this.clock().getTime();
    const cached = this.#cache.get(cep);
    if (cached !== undefined && cached.until > now) return cached.address;
    let answeredNotFound = false;
    for (const source of this.sources) {
      try {
        const found = await source.lookup(cep, AbortSignal.timeout(POSTAL_CODE_SOURCE_TIMEOUT_MS));
        if (found !== null) {
          this.remember(cep, { until: now + FOUND_TTL_MS, address: { value: found, source: source.name } });
          return { value: found, source: source.name };
        }
        answeredNotFound = true;
      } catch {
        // Unreachable, slow or garbled source: try the next one. Never surfaced to the user.
      }
    }
    // A definitive "not found" is cached briefly; a total failure is not cached at all (the next call tries again).
    if (answeredNotFound) this.remember(cep, { until: now + NOT_FOUND_TTL_MS, address: null });
    return null;
  }

  private remember(cep: string, entry: CacheEntry): void {
    if (this.#cache.size >= CACHE_LIMIT) {
      const oldest = this.#cache.keys().next();
      if (!oldest.done) this.#cache.delete(oldest.value);
    }
    this.#cache.set(cep, entry);
  }
}
