import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateSellerDiscountRuleRequest,
  ForceSettings,
  SellerDiscountRuleRecord,
  SellerDiscountRulesResponse,
  UpdateForceSettingsRequest,
  UpdateSellerDiscountRuleRequest,
} from '@salesforce/contracts';
import { normalizeDecimalString, resolveForceConfig, type ResolvedForceConfig } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { ForceConfigRepository, type DiscountRuleRow } from './force-config.repository.js';

export interface ConfigActor {
  readonly accountId: string;
}

function validationIssue(path: string, code: string, message: string): AppError {
  return new AppError('validation_failed', { details: { issues: [{ path, code, message }] } });
}

function toRecord(row: DiscountRuleRow): SellerDiscountRuleRecord {
  return {
    id: row.id,
    sellerCode: row.sellerCode,
    sellerName: row.sellerName,
    targetKind: row.targetKind,
    targetCode: row.targetCode,
    targetName: row.targetName,
    maxPercent: normalizeDecimalString(row.maxPercent),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The Force own configuration (owner ruling 2026-11-27): settings and per-seller discount rules live in the Force database and are
 * edited on the site by admin and manager (central policy). Nothing is read from the ERP configuration.
 */
@Injectable()
export class ForceConfigService {
  constructor(
    @Inject(ForceConfigRepository) private readonly repo: ForceConfigRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The effective values (domain defaults when the row is missing). Used by sessions, catalog and registration. */
  async resolved(): Promise<ResolvedForceConfig> {
    const row = await this.repo.settings();
    return resolveForceConfig(row === null ? null : { maxDaysWithoutSync: row.maxDaysWithoutSync, defaultPriceTableCode: row.defaultPriceTableCode });
  }

  async getSettings(): Promise<ForceSettings> {
    const row = await this.repo.settings();
    const resolved = resolveForceConfig(row === null ? null : { maxDaysWithoutSync: row.maxDaysWithoutSync, defaultPriceTableCode: row.defaultPriceTableCode });
    return {
      maxDaysWithoutSync: resolved.daysWithoutSync,
      defaultPriceTableCode: resolved.defaultPriceTableCode,
      updatedAt: (row?.updatedAt ?? this.clock()).toISOString(),
    };
  }

  async saveSettings(actor: ConfigActor, next: UpdateForceSettingsRequest): Promise<ForceSettings> {
    if (!(await this.repo.priceTableExists(next.defaultPriceTableCode))) {
      throw validationIssue('defaultPriceTableCode', 'price_table_not_found', 'Tabela de preço não encontrada ou inativa.');
    }
    const now = this.clock();
    await this.repo.transaction(async (tx) => {
      const before = await this.repo.settings(tx);
      await this.repo.saveSettings(next, actor.accountId, now, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.forceConfigChanged,
          actorAccountId: actor.accountId,
          detail: {
            maxDaysWithoutSync: next.maxDaysWithoutSync,
            defaultPriceTableCode: next.defaultPriceTableCode,
            previousMaxDaysWithoutSync: before?.maxDaysWithoutSync ?? null,
            previousDefaultPriceTableCode: before?.defaultPriceTableCode ?? null,
          },
        },
        tx,
      );
    });
    return this.getSettings();
  }

  /* ---------- per-seller discount rules ---------- */

  async listRules(sellerCode: number | undefined): Promise<SellerDiscountRulesResponse> {
    return { items: (await this.repo.listRules(sellerCode)).map(toRecord) };
  }

  async createRule(actor: ConfigActor, body: CreateSellerDiscountRuleRequest): Promise<SellerDiscountRuleRecord> {
    if (!(await this.repo.sellerExists(body.sellerCode))) throw validationIssue('sellerCode', 'seller_not_found', 'Representante não encontrado.');
    if (!(await this.repo.targetExists(body.targetKind, body.targetCode))) {
      throw validationIssue('targetCode', 'target_not_found', body.targetKind === 'product' ? 'Produto não encontrado.' : 'Grupo não encontrado.');
    }
    const id = uuidv7();
    const now = this.clock();
    await this.repo.transaction(async (tx) => {
      const created = await this.repo.insertRule(
        { id, sellerCode: body.sellerCode, targetKind: body.targetKind, targetCode: body.targetKind === 'none' ? null : body.targetCode, maxPercent: body.maxPercent },
        actor.accountId,
        now,
        tx,
      );
      if (!created) throw new AppError('conflict', { message: 'Este representante já tem uma regra para este alvo.' });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.sellerDiscountRuleChanged,
          actorAccountId: actor.accountId,
          detail: { change: 'created', ruleId: id, sellerCode: body.sellerCode, targetKind: body.targetKind, targetCode: body.targetCode, maxPercent: body.maxPercent },
        },
        tx,
      );
    });
    return this.requireRule(id);
  }

  async updateRule(actor: ConfigActor, id: string, body: UpdateSellerDiscountRuleRequest): Promise<SellerDiscountRuleRecord> {
    const now = this.clock();
    await this.repo.transaction(async (tx) => {
      const before = await this.repo.findRule(id, tx);
      if (before === null) throw new AppError('not_found');
      await this.repo.updateRulePercent(id, body.maxPercent, actor.accountId, now, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.sellerDiscountRuleChanged,
          actorAccountId: actor.accountId,
          detail: {
            change: 'updated',
            ruleId: id,
            sellerCode: before.sellerCode,
            targetKind: before.targetKind,
            targetCode: before.targetCode,
            maxPercent: body.maxPercent,
            previousMaxPercent: normalizeDecimalString(before.maxPercent),
          },
        },
        tx,
      );
    });
    return this.requireRule(id);
  }

  async deleteRule(actor: ConfigActor, id: string): Promise<void> {
    await this.repo.transaction(async (tx) => {
      const before = await this.repo.findRule(id, tx);
      if (before === null) throw new AppError('not_found');
      await this.repo.deleteRule(id, tx);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.sellerDiscountRuleChanged,
          actorAccountId: actor.accountId,
          detail: {
            change: 'deleted',
            ruleId: id,
            sellerCode: before.sellerCode,
            targetKind: before.targetKind,
            targetCode: before.targetCode,
            previousMaxPercent: normalizeDecimalString(before.maxPercent),
          },
        },
        tx,
      );
    });
  }

  private async requireRule(id: string): Promise<SellerDiscountRuleRecord> {
    const row = await this.repo.findRule(id);
    if (row === null) throw new AppError('not_found');
    return toRecord(row);
  }
}
