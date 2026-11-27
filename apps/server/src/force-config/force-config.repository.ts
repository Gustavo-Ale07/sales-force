import { Inject, Injectable } from '@nestjs/common';
import {
  erpPriceTable,
  erpProduct,
  erpProductGroup,
  erpSeller,
  forceConfig,
  sellerDiscountRule,
  type Database,
} from '@salesforce/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { AuditWriter } from '../iam/audit.service.js';
import { DATABASE } from '../platform/tokens.js';

export type ForceConfigTx = Pick<Database, 'select' | 'insert' | 'update' | 'delete'> & AuditWriter;
type Reader = Pick<Database, 'select'>;

export interface ForceSettingsRow {
  readonly maxDaysWithoutSync: number;
  readonly defaultPriceTableCode: number;
  readonly updatedAt: Date;
}

export type RuleTargetKind = 'product' | 'subgroup' | 'group' | 'none';

export interface DiscountRuleRow {
  readonly id: string;
  readonly sellerCode: number;
  readonly sellerName: string | null;
  readonly targetKind: RuleTargetKind;
  readonly targetCode: number | null;
  readonly targetName: string | null;
  readonly maxPercent: string;
  readonly updatedAt: Date;
}

/** The Force own configuration tables (owner ruling 2026-11-27): the single settings row and the per-seller discount rules. */
@Injectable()
export class ForceConfigRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: ForceConfigTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx as unknown as ForceConfigTx));
  }

  /** The single settings row; null only when the seed row is missing (the domain fallback then applies). */
  async settings(reader: Reader = this.db): Promise<ForceSettingsRow | null> {
    const [row] = await reader
      .select({ maxDaysWithoutSync: forceConfig.maxDaysWithoutSync, defaultPriceTableCode: forceConfig.defaultPriceTableCode, updatedAt: forceConfig.updatedAt })
      .from(forceConfig)
      .where(eq(forceConfig.id, 1));
    return row ?? null;
  }

  async saveSettings(
    values: { readonly maxDaysWithoutSync: number; readonly defaultPriceTableCode: number },
    actorAccountId: string,
    now: Date,
    writer: Pick<Database, 'insert'> = this.db,
  ): Promise<void> {
    await writer
      .insert(forceConfig)
      .values({ id: 1, ...values, updatedAt: now, updatedBy: actorAccountId })
      .onConflictDoUpdate({ target: forceConfig.id, set: { ...values, updatedAt: now, updatedBy: actorAccountId } });
  }

  /** The price table exists in the ERP mirror (active, live). */
  async priceTableExists(code: number, reader: Reader = this.db): Promise<boolean> {
    const rows = await reader
      .select({ code: erpPriceTable.code })
      .from(erpPriceTable)
      .where(and(eq(erpPriceTable.code, code), eq(erpPriceTable.active, true), isNull(erpPriceTable.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async sellerExists(code: number, reader: Reader = this.db): Promise<boolean> {
    const rows = await reader
      .select({ code: erpSeller.code })
      .from(erpSeller)
      .where(and(eq(erpSeller.code, code), isNull(erpSeller.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async targetExists(kind: RuleTargetKind, code: number | null, reader: Reader = this.db): Promise<boolean> {
    if (kind === 'none') return code === null;
    if (code === null) return false;
    if (kind === 'product') {
      const rows = await reader.select({ code: erpProduct.code }).from(erpProduct).where(and(eq(erpProduct.code, code), isNull(erpProduct.deletedAt))).limit(1);
      return rows.length > 0;
    }
    const rows = await reader
      .select({ code: erpProductGroup.code })
      .from(erpProductGroup)
      .where(and(eq(erpProductGroup.code, code), isNull(erpProductGroup.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  private ruleSelect(reader: Reader) {
    return reader
      .select({
        id: sellerDiscountRule.id,
        sellerCode: sellerDiscountRule.sellerCode,
        sellerName: erpSeller.name,
        targetKind: sellerDiscountRule.targetKind,
        targetCode: sellerDiscountRule.targetCode,
        productName: erpProduct.description,
        groupName: erpProductGroup.name,
        maxPercent: sellerDiscountRule.maxPercent,
        updatedAt: sellerDiscountRule.updatedAt,
      })
      .from(sellerDiscountRule)
      .leftJoin(erpSeller, eq(erpSeller.code, sellerDiscountRule.sellerCode))
      .leftJoin(erpProduct, and(eq(sellerDiscountRule.targetKind, 'product'), eq(erpProduct.code, sellerDiscountRule.targetCode)))
      .leftJoin(
        erpProductGroup,
        and(sql`${sellerDiscountRule.targetKind} in ('group', 'subgroup')`, eq(erpProductGroup.code, sellerDiscountRule.targetCode)),
      );
  }

  private toRow(row: {
    id: string;
    sellerCode: number;
    sellerName: string | null;
    targetKind: string;
    targetCode: number | null;
    productName: string | null;
    groupName: string | null;
    maxPercent: string;
    updatedAt: Date;
  }): DiscountRuleRow {
    return {
      id: row.id,
      sellerCode: row.sellerCode,
      sellerName: row.sellerName,
      targetKind: row.targetKind as RuleTargetKind,
      targetCode: row.targetCode,
      targetName: row.targetKind === 'product' ? row.productName : row.targetKind === 'none' ? null : row.groupName,
      maxPercent: row.maxPercent,
      updatedAt: row.updatedAt,
    };
  }

  async listRules(sellerCode: number | undefined, reader: Reader = this.db): Promise<DiscountRuleRow[]> {
    const rows = await this.ruleSelect(reader)
      .where(sellerCode === undefined ? undefined : eq(sellerDiscountRule.sellerCode, sellerCode))
      .orderBy(asc(sellerDiscountRule.sellerCode), asc(sellerDiscountRule.targetKind), asc(sellerDiscountRule.targetCode));
    return rows.map((row) => this.toRow(row));
  }

  async findRule(id: string, reader: Reader = this.db): Promise<DiscountRuleRow | null> {
    const [row] = await this.ruleSelect(reader).where(eq(sellerDiscountRule.id, id));
    return row === undefined ? null : this.toRow(row);
  }

  /** Raw rules of ONE seller (sync of the app and order revalidation): scope is the query. */
  async rulesOfSeller(sellerCode: number, reader: Reader = this.db): Promise<{ kind: RuleTargetKind; code: number | null; percent: string }[]> {
    const rows = await reader
      .select({ kind: sellerDiscountRule.targetKind, code: sellerDiscountRule.targetCode, percent: sellerDiscountRule.maxPercent })
      .from(sellerDiscountRule)
      .where(eq(sellerDiscountRule.sellerCode, sellerCode))
      .orderBy(asc(sellerDiscountRule.targetKind), asc(sellerDiscountRule.targetCode));
    return rows.map((r) => ({ kind: r.kind as RuleTargetKind, code: r.code, percent: r.percent }));
  }

  /** False when the (seller, kind, target) already has a rule. */
  async insertRule(
    values: { id: string; sellerCode: number; targetKind: RuleTargetKind; targetCode: number | null; maxPercent: string },
    actorAccountId: string,
    now: Date,
    writer: Pick<Database, 'insert'> = this.db,
  ): Promise<boolean> {
    const inserted = await writer
      .insert(sellerDiscountRule)
      .values({ ...values, createdAt: now, updatedAt: now, updatedBy: actorAccountId })
      .onConflictDoNothing()
      .returning({ id: sellerDiscountRule.id });
    return inserted.length > 0;
  }

  async updateRulePercent(id: string, maxPercent: string, actorAccountId: string, now: Date, writer: Pick<Database, 'update'> = this.db): Promise<boolean> {
    const updated = await writer
      .update(sellerDiscountRule)
      .set({ maxPercent, updatedAt: now, updatedBy: actorAccountId })
      .where(eq(sellerDiscountRule.id, id))
      .returning({ id: sellerDiscountRule.id });
    return updated.length > 0;
  }

  async deleteRule(id: string, writer: Pick<Database, 'delete'> = this.db): Promise<boolean> {
    const deleted = await writer.delete(sellerDiscountRule).where(eq(sellerDiscountRule.id, id)).returning({ id: sellerDiscountRule.id });
    return deleted.length > 0;
  }
}
