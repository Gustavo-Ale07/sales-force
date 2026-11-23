import type { ReactElement } from "react";
import { AppModalProvider } from "./ui/app-modal";

/** Test helper: screens use `useAppModal`/`useErrorPopup`, which throw outside the provider. `render(withModal(<Screen />))`; also for `rerender`. */
export function withModal(element: ReactElement): ReactElement {
  return <AppModalProvider>{element}</AppModalProvider>;
}
