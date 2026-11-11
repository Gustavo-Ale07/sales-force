import { validateSalesHistoryTops, type SalesHistoryTops } from '@salesforce/domain';
import type { SalesHistoryDateField, SalesHistoryReadConfig } from '@salesforce/sankhya';

/**
 * Sales-history mirror configuration (stage D block 1, CFG-3): which ERP notes count as a sale or a return.
 * Installation configuration read from the worker environment, never a literal in the source. NEEDS VALIDATION with the ERP
 * owner (docs/sankhya-spike.md): the TOP sets, the valid-note status set and the date field. The mirror stays off (no
 * schedule, runs report `not_configured`) until at least one sale TOP is configured.
 */
export interface SalesHistorySyncConfig {
  readonly tops: SalesHistoryTops;
  readonly statusCodes: readonly string[];
  readonly dateField: SalesHistoryDateField;
  readonly windowMonths: number;
}

/** The raw, already shape-validated environment values (see `WorkerEnvSchema`). */
export interface SalesHistoryEnvValues {
  readonly SALES_HISTORY_SALE_TOPS: readonly number[];
  readonly SALES_HISTORY_RETURN_TOPS: readonly number[];
  readonly SALES_HISTORY_STATUS_CODES: readonly string[];
  readonly SALES_HISTORY_DATE_FIELD: SalesHistoryDateField;
  readonly SALES_HISTORY_WINDOW_MONTHS: number;
}

export interface SalesHistoryConfigOutcome {
  readonly config: SalesHistorySyncConfig | null;
  readonly problems: readonly string[];
}

const PROBLEM_TEXT = {
  no_sale_top: 'SALES_HISTORY_RETURN_TOPS is set but SALES_HISTORY_SALE_TOPS is empty: a return TOP needs at least one sale TOP.',
  invalid_top_code: 'SALES_HISTORY_SALE_TOPS / SALES_HISTORY_RETURN_TOPS: every TOP code must be a positive integer.',
  top_is_sale_and_return: 'SALES_HISTORY_SALE_TOPS and SALES_HISTORY_RETURN_TOPS: a TOP cannot be both a sale and a return.',
} as const;

/** `config: null` with no problem = not configured (the mirror is simply off). */
export function salesHistorySyncConfigFromEnv(env: SalesHistoryEnvValues): SalesHistoryConfigOutcome {
  if (env.SALES_HISTORY_SALE_TOPS.length === 0 && env.SALES_HISTORY_RETURN_TOPS.length === 0) return { config: null, problems: [] };
  const tops = validateSalesHistoryTops({ saleTopCodes: env.SALES_HISTORY_SALE_TOPS, returnTopCodes: env.SALES_HISTORY_RETURN_TOPS });
  if (!tops.ok) return { config: null, problems: [PROBLEM_TEXT[tops.reason]] };
  return {
    config: {
      tops: tops.value,
      statusCodes: [...new Set(env.SALES_HISTORY_STATUS_CODES)].sort(),
      dateField: env.SALES_HISTORY_DATE_FIELD,
      windowMonths: env.SALES_HISTORY_WINDOW_MONTHS,
    },
    problems: [],
  };
}

/** The gateway read configuration: sale and return TOPs are read together. */
export function salesHistoryReadConfig(config: SalesHistorySyncConfig): SalesHistoryReadConfig {
  return {
    topCodes: [...config.tops.saleTopCodes, ...config.tops.returnTopCodes],
    statusCodes: config.statusCodes,
    dateField: config.dateField,
    windowMonths: config.windowMonths,
  };
}
