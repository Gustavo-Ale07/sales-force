import type { UpdateResult, UpdateStep } from "./apk-update";

/** Seller-facing text (pt-BR) for each outcome of the in-app update. */
export function updateResultMessage(result: UpdateResult): string {
  switch (result.kind) {
    case "up-to-date":
      return "O aplicativo já está na versão mais recente.";
    case "skipped":
      return "Atualização adiada.";
    case "installer-opened":
      return `Versão ${result.release.versionName} baixada e verificada. Confirme a instalação na tela do Android.`;
    case "unavailable":
      return result.reason === "network" ? "Sem conexão para verificar atualizações. Tente novamente." : "Atualização indisponível nesta versão do aplicativo.";
    case "failed":
      if (result.reason === "download") return "Não foi possível baixar a atualização. Tente novamente.";
      if (result.reason === "install") return "Não foi possível abrir o instalador do Android. Permita a instalação de apps desta fonte e tente de novo.";
      return "O arquivo baixado não passou na verificação de integridade e foi descartado. Avise o suporte.";
  }
}

export function updateStepMessage(step: UpdateStep, progress?: { written: number; total: number }): string {
  if (step === "checking") return "Verificando atualizações…";
  if (step === "downloading") return progress && progress.total > 0 ? `Baixando… ${Math.min(100, Math.floor((progress.written / progress.total) * 100))}%` : "Baixando…";
  if (step === "verifying") return "Verificando integridade…";
  return "Abrindo o instalador…";
}
