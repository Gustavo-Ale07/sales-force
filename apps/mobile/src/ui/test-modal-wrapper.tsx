import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react-native";
import { AppModalProvider } from "./app-modal";

/** Test wrapper: screens that call `useAppModal()` throw outside the provider, so tests render inside it. */
export function ModalWrapper({ children }: { children: ReactNode }) {
  return <AppModalProvider>{children}</AppModalProvider>;
}

/** `render` with the in-app modal provider around the tree. */
export function renderWithModal(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { ...options, wrapper: ModalWrapper });
}
