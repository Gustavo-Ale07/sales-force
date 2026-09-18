import { Card, EmptyState, PageHeader } from "@salesforce/ui";
import { Hammer } from "lucide-react";
import type { ReactNode } from "react";

export interface ComingSoonProps {
  title: string;
  description: string;
  /** Blueprint screen id(s) this route will implement, e.g. "W-07". */
  screen?: string;
  actions?: ReactNode;
}

/** Placeholder for routes whose data contracts are not wired yet. Replaced by the real page. */
export function ComingSoon({ title, description, screen, actions }: ComingSoonProps) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <Card>
        <EmptyState
          icon={<Hammer size={16} />}
          title="Em construção"
          description={`Esta tela ainda não está conectada aos dados.${screen ? ` Tela do blueprint: ${screen}.` : ""}`}
        />
      </Card>
    </>
  );
}
