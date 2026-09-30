/**
 * Which orders may ever reach the ERP (SNK-4, SNK-6, P-15/SNK-3). Pure and deterministic.
 *
 * An order carries an immutable binding stamped by the server at creation: the dataset it was priced
 * against (`datasetOrigin`) and the ERP environment that dataset came from (`erpEnvironment`).
 * Only an order from a real Sankhya dataset, bound to the very environment being targeted, is
 * eligible. Everything else (legacy DEV data, fake/demo data, an unbound or different environment,
 * any unknown value) is refused: the check fails closed.
 */
import { canTransitionOrder, type OrderStatus } from './status.js';

export const DATASET_ORIGINS = ['legacy_dev', 'fake', 'sankhya'] as const;
export type DatasetOrigin = (typeof DATASET_ORIGINS)[number];

export interface ErpBinding {
  /** Kept a `string`: values read from storage are never trusted to be known. */
  readonly datasetOrigin: string;
  readonly erpEnvironment: string | null;
}

export interface ErpSubmissionTarget {
  /** The environment the writer is about to send to (`sandbox`, `homologation`, `production`...). */
  readonly environment: string;
}

export type ErpSubmissionBlock = 'dataset_not_erp' | 'environment_unbound' | 'environment_mismatch';

export function erpSubmissionBlock(binding: ErpBinding, target: ErpSubmissionTarget): ErpSubmissionBlock | null {
  if (binding.datasetOrigin !== 'sankhya') return 'dataset_not_erp';
  if (binding.erpEnvironment === null || binding.erpEnvironment === '') return 'environment_unbound';
  if (target.environment === '' || binding.erpEnvironment !== target.environment) return 'environment_mismatch';
  return null;
}

export function isEligibleForErpSubmission(binding: ErpBinding, target: ErpSubmissionTarget): boolean {
  return erpSubmissionBlock(binding, target) === null;
}

/** A draft may be queued only when the transition is reachable AND the order is eligible for the target. */
export function canQueueOrder(order: ErpBinding & { readonly status: OrderStatus }, target: ErpSubmissionTarget): boolean {
  return canTransitionOrder(order.status, 'queued') && isEligibleForErpSubmission(order, target);
}

/**
 * Dataset origin stamped on a new order from the configuration version it was priced against.
 * Anything but a real Sankhya source is `fake`. A `sankhya` source alone does not make an order
 * eligible: the environment binding must also be present.
 */
export function datasetOriginForConfigurationSource(sourceKind: string): DatasetOrigin {
  return sourceKind === 'sankhya' ? 'sankhya' : 'fake';
}
