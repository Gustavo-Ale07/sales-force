import { ICMS_CLASSIFICATION_LABELS } from "@salesforce/contracts";
import type { IcmsClassificationOption } from "./customer-form";

/** Classification names shown to the user; the value sent stays the letter. */
export function useIcmsOptions(): readonly IcmsClassificationOption[] {
  return ICMS_CLASSIFICATION_LABELS;
}
