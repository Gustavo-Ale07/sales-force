import type { IneligibleReason } from "@salesforce/mobile-db";

/**
 * Seller-facing wording for the retained ("Pedidos antigos retidos") orders. These orders are never sent: the text says
 * so plainly and never offers to convert, resend or retry them.
 */
export function describeQuarantineReason(reason: IneligibleReason): string {
  switch (reason) {
    case "legacy_local":
      return "Criado antes da verificação de dados; não será enviado ao Force.";
    case "environment_mismatch":
    case "dataset_mismatch":
      return "Criado com outro conjunto de dados; não será enviado ao Force.";
    case "owner_mismatch":
      return "Criado por outra conta; não será enviado ao Force.";
  }
}

export const QUARANTINE_TITLE = "Pedidos antigos retidos";

export const QUARANTINE_INTRO =
  "Estes pedidos foram criados antes da verificação de dados do aplicativo. Por segurança, eles não são enviados ao Force. Você pode consultá-los e, se quiser, descartá-los deste aparelho.";
