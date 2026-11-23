import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from "react-native";
import { colors, spacing } from "../theme";

/**
 * The one dialog of the app (owner 2026-11-13: no native dialogs). Mounted once by `AppModalProvider`; screens call
 * `useAppModal()` and never render their own overlay. Dialogs queue: a second one waits for the first to close.
 */

export type ModalVariant = "info" | "confirm" | "error";
/** `primary` = filled navy, `destructive` = filled red, `secondary` = outline (another way forward), `cancel` = outline and what hardware Back does. */
export type ModalButtonRole = "primary" | "destructive" | "secondary" | "cancel";

export interface ModalButton {
  readonly label: string;
  readonly role?: ModalButtonRole;
  readonly onPress?: () => void;
}

export interface ModalOptions {
  readonly variant?: ModalVariant;
  readonly title: string;
  readonly message?: string;
  /** Default: a single "Entendi" button. */
  readonly buttons?: readonly ModalButton[];
  /** Technical text behind "Ver detalhes" (code, message). Selectable, so a long press copies it. */
  readonly details?: string;
}

export interface ConfirmOptions {
  readonly variant?: ModalVariant;
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** The confirm button turns red. */
  readonly destructive?: boolean;
}

export interface AppModalApi {
  /** Full control: any buttons. */
  readonly show: (options: ModalOptions) => void;
  /** Resolves true on the confirm button, false on cancel or hardware Back. */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly inform: (title: string, message?: string) => void;
}

interface QueuedModal {
  readonly key: number;
  readonly options: ModalOptions;
}

const ROLE_ORDER: Record<ModalButtonRole, number> = { primary: 0, destructive: 1, secondary: 2, cancel: 3 };

const AppModalContext = createContext<AppModalApi | null>(null);

export function useAppModal(): AppModalApi {
  const api = useContext(AppModalContext);
  if (api === null) throw new Error("useAppModal must be used inside AppModalProvider");
  return api;
}

/**
 * `copyText`: puts text on the clipboard. Not wired yet: the app has no clipboard module (a dependency decision). Without
 * it the details stay selectable (long press copies), and no "Copiar" button is drawn.
 */
export function AppModalProvider({ children, copyText }: { children: ReactNode; copyText?: (text: string) => void | Promise<void> }) {
  const [queue, setQueue] = useState<readonly QueuedModal[]>([]);
  const counter = useRef(0);

  const show = useCallback((options: ModalOptions) => {
    counter.current += 1;
    const entry = { key: counter.current, options };
    setQueue((current) => [...current, entry]);
  }, []);
  const dismiss = useCallback((key: number) => setQueue((current) => current.filter((entry) => entry.key !== key)), []);

  const api = useMemo<AppModalApi>(
    () => ({
      show,
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          show({
            variant: options.variant ?? "confirm",
            title: options.title,
            message: options.message,
            buttons: [
              { label: options.confirmLabel ?? "Confirmar", role: options.destructive === true ? "destructive" : "primary", onPress: () => resolve(true) },
              { label: options.cancelLabel ?? "Cancelar", role: "cancel", onPress: () => resolve(false) },
            ],
          });
        }),
      inform: (title, message) => show({ variant: "info", title, message }),
    }),
    [show],
  );

  const current = queue[0];
  return (
    <AppModalContext.Provider value={api}>
      {children}
      {current !== undefined && <AppModalView key={current.key} options={current.options} onClose={() => dismiss(current.key)} copyText={copyText} />}
    </AppModalContext.Provider>
  );
}

const VARIANT_STYLE: Record<ModalVariant, { glyph: string; color: string; background: string; label: string }> = {
  info: { glyph: "i", color: colors.navy, background: "#e6e9f5", label: "Informação" },
  confirm: { glyph: "?", color: colors.navy, background: "#e6e9f5", label: "Confirmação" },
  error: { glyph: "!", color: colors.red, background: colors.errorBackground, label: "Erro" },
};

/** One dialog on screen. Exported for tests that render it without the provider. */
export function AppModalView({ options, onClose, copyText }: { options: ModalOptions; onClose: () => void; copyText?: (text: string) => void | Promise<void> }) {
  const variant = options.variant ?? "info";
  const look = VARIANT_STYLE[variant];
  const buttons = useMemo(
    () => [...(options.buttons ?? [{ label: "Entendi", role: "primary" as const }])].sort((a, b) => ROLE_ORDER[a.role ?? "secondary"] - ROLE_ORDER[b.role ?? "secondary"]),
    [options.buttons],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    let active = true;
    const run = (reduced: boolean) => {
      if (!active) return;
      if (reduced) progress.setValue(1);
      else Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    };
    // Reduced motion: no scale or fade, the dialog just appears.
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(run, () => run(false));
    // Move screen-reader focus to the dialog title.
    const node = titleRef.current === null ? null : findNodeHandle(titleRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    return () => {
      active = false;
    };
  }, [progress]);

  const press = (button: ModalButton) => {
    onClose();
    button.onPress?.();
  };
  // Hardware Back / swipe-back: the cancel button's action; an info dialog just closes.
  const cancel = () => press(buttons.find((button) => button.role === "cancel") ?? { label: "" });

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  return (
    <Modal transparent visible animationType="none" onRequestClose={cancel} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Animated.View
          style={[styles.card, { transform: [{ scale }] }]}
          role="alertdialog"
          accessibilityViewIsModal
          accessibilityLabel={options.title}
          testID="app-modal"
        >
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: look.background }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={[styles.iconGlyph, { color: look.color }]}>{look.glyph}</Text>
            </View>
            <Text ref={titleRef} style={styles.title} accessibilityRole="header">{options.title}</Text>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {options.message !== undefined && options.message !== "" && <Text style={styles.message}>{options.message}</Text>}
            {options.details !== undefined && options.details !== "" && (
              <View>
                <Pressable onPress={() => setDetailsOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} style={styles.detailsToggle}>
                  <Text style={styles.detailsToggleText}>{detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}</Text>
                </Pressable>
                {detailsOpen && (
                  <Text style={styles.details} selectable testID="app-modal-details">
                    {options.details}
                  </Text>
                )}
                {detailsOpen && copyText !== undefined && (
                  <Pressable onPress={() => { void copyText(options.details ?? ""); setCopied(true); }} accessibilityRole="button" style={styles.detailsToggle}>
                    <Text style={styles.detailsToggleText}>{copied ? "Copiado" : "Copiar"}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>
          <View style={styles.buttons}>
            {buttons.map((button, index) => {
              const role = button.role ?? "secondary";
              const filled = role === "primary" || role === "destructive";
              return (
                <Pressable
                  key={`${index}-${button.label}`}
                  onPress={() => press(button)}
                  accessibilityRole="button"
                  accessibilityLabel={button.label}
                  style={({ pressed }) => [
                    styles.button,
                    filled ? { backgroundColor: role === "destructive" ? colors.red : colors.navy } : styles.buttonOutline,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.buttonText, { color: filled ? colors.onNavy : role === "cancel" ? colors.textMuted : colors.navy }]}>{button.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0, 13, 77, 0.55)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 420, maxHeight: "85%", backgroundColor: colors.surface, borderRadius: 20, padding: spacing.xl, gap: spacing.lg },
  header: { alignItems: "center", gap: spacing.md },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  iconGlyph: { fontSize: 26, fontWeight: "800" },
  title: { fontSize: 19, fontWeight: "800", color: colors.text, textAlign: "center" },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing.md },
  message: { fontSize: 15, lineHeight: 21, color: colors.textMuted, textAlign: "center" },
  detailsToggle: { minHeight: 36, alignItems: "center", justifyContent: "center" },
  detailsToggleText: { fontSize: 13, fontWeight: "700", color: colors.navy, textDecorationLine: "underline" },
  details: { fontSize: 12, color: colors.textMuted, backgroundColor: colors.background, borderRadius: 8, padding: spacing.md, fontFamily: "monospace" },
  buttons: { gap: spacing.sm },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonOutline: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonText: { fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.85 },
});
