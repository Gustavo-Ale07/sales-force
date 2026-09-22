import { Alert } from "@salesforce/ui";
import { templateSkipReasonLabels, type SkippedTemplateLine } from "../lib/order-templates";

export interface TemplateSkippedNoticeProps {
  lines: readonly SkippedTemplateLine[];
  /** Lead sentence under the title; defaults to the "draft was created" wording. */
  description?: string;
  onDismiss?: () => void;
}

/** Non-blocking notice listing template lines left out of the draft (product code + reason). Renders nothing when empty. */
export function TemplateSkippedNotice({ lines, description, onDismiss }: TemplateSkippedNoticeProps) {
  if (lines.length === 0) return null;
  const title = lines.length === 1 ? "1 item do modelo não entrou no pedido" : `${lines.length} itens do modelo não entraram no pedido`;
  return (
    <Alert
      tone="warning"
      title={title}
      onDismiss={onDismiss}
      dismissLabel="Dispensar aviso"
      aria-label="Itens do modelo que ficaram de fora"
    >
      {description ? <span className="block">{description}</span> : null}
      <ul className="m-0 mt-1 list-disc pl-4">
        {lines.map((line) => (
          <li key={`${line.lineNo}:${line.productCode}`}>
            Item {line.lineNo} · Código {line.productCode}: {templateSkipReasonLabels[line.reason]}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
