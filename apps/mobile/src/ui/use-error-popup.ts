import { createContext, useContext, useMemo } from "react";
import { ACTION_LABELS, describeProblem, problemForCode, type Problem, type ProblemAction } from "../data/error-catalog";
import { useAppModal, type ModalButton } from "./app-modal";

/** What each fixing action does on the calling screen. An action without a handler is simply not offered. */
export type ProblemHandlers = Partial<Record<Exclude<ProblemAction, "none">, () => void>>;

/** App-wide actions the shell provides (go to the sync panel, back to sign-in); a screen's own handler wins. */
export const ErrorActionsContext = createContext<ProblemHandlers>({});

export interface ErrorPopupApi {
  /** Shows the popup for any thrown value. Returns the described problem (for logging or state). */
  readonly report: (error: unknown, handlers?: ProblemHandlers, override?: ProblemOverride) => Problem;
  /** Shows the popup for a known catalog code (stored markers, local guards). */
  readonly reportCode: (code: string, handlers?: ProblemHandlers, detail?: string, override?: ProblemOverride) => Problem;
}

/** Context the catalog cannot know ("Não foi possível duplicar"); the code and the technical details stay the catalog's. */
export interface ProblemOverride {
  readonly title?: string;
  readonly message?: string;
}

/**
 * Screen-level hook for every failure path: `const errors = useErrorPopup(); errors.report(error, { retry, goSync })`.
 * Title and text come from the central catalog, the button of the problem's action runs the screen's handler, and the
 * technical text sits behind "Ver detalhes". Must be used inside `AppModalProvider`.
 */
export function useErrorPopup(): ErrorPopupApi {
  const modal = useAppModal();
  const shared = useContext(ErrorActionsContext);
  return useMemo(() => {
    const present = (found: Problem, local: ProblemHandlers | undefined, override: ProblemOverride | undefined): Problem => {
      const problem: Problem = { ...found, ...(override?.title === undefined ? {} : { title: override.title }), ...(override?.message === undefined ? {} : { message: override.message }) };
      const handlers = { ...shared, ...local };
      const buttons: ModalButton[] = [];
      if (problem.action !== "none") {
        const handler = handlers[problem.action];
        if (handler !== undefined) buttons.push({ label: ACTION_LABELS[problem.action], role: "primary", onPress: handler });
      }
      buttons.push({ label: "Fechar", role: buttons.length === 0 ? "primary" : "cancel" });
      modal.show({ variant: "error", title: problem.title, message: problem.message, details: problem.details, buttons });
      return problem;
    };
    return {
      report: (error, handlers, override) => present(describeProblem(error), handlers, override),
      reportCode: (code, handlers, detail, override) => present(problemForCode(code, detail), handlers, override),
    };
  }, [modal, shared]);
}
