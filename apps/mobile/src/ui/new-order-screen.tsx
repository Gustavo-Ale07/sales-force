import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { DatasetChangedError, DatasetUnavailableError, type ConfirmOutcome, type DraftRecord } from "@salesforce/mobile-db";
import { ORDER_HEADER_ISSUE_LABEL, orderHeaderIssues, type OrderHeaderIssueCode } from "@salesforce/domain";
import { datasetIdentityOf } from "../offline/reference-source";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiRequestError } from "../data/api";
import { codeOfHeldMessage } from "../data/error-catalog";
import { describeDataError, type DataErrorInfo } from "../data/errors";
import {
  bulkOverLimit,
  decrementLineQuantity,
  discountExceedsLimit,
  incrementLineQuantity,
  isLinePriceOrderable,
  lineAmountsOf,
  lineFromOrderItem,
  lineFromProduct,
  orderSignature,
  previewDraft,
  toRequestItems,
  type EditorLine,
} from "../data/order-draft";
import type { Carrier, CustomerListItem, OrderDetail, OrderEntryConfiguration, OrderRepository, ProductListItem, Repositories } from "../data/ports";
import { formatBrl } from "../lib/money";
import type { LocalOrdersPort } from "../offline/local-orders";
import { newClientRequestId } from "../lib/uuid";
import { FOLLOW_BUDGET_MS, followDelay, orderIdentity } from "../offline/order-number";
import { useAppModal } from "./app-modal";
import { useErrorPopup } from "./use-error-popup";
import { OrderHeaderOptions } from "./order-header-options";
import { NOTES_MAX, NotesField, SummaryBlock, SummaryRow, WIZARD_STEPS, WizardFooter, WizardProgress, type WizardStep } from "./order-wizard-parts";
import { isQuotationTop, topLabel } from "../data/order-header";
import { describeListPrice } from "../lib/money";
import { colors, control, radius, spacing } from "../theme";
import { Icon } from "./icons";
import { CartView, OrderTotals } from "./cart-view";
import { Thumb } from "./product-views";
import { CustomerPicker } from "./customer-picker";
import { BulkDiscountSheet } from "./bulk-discount-sheet";
import { ProductPicker } from "./product-picker";
import type { ProductOrderActions } from "./product-views";

function blockedItemsMessage(count: number): string {
  const subject = count === 1 ? "1 item sem preço não pode ser salvo" : `${count} itens sem preço não podem ser salvos`;
  return `${subject} nesta instalação. Remova-${count === 1 ? "o" : "os"} ou aguarde a atualização de preços.`;
}

/** The order is a 4-step wizard: Cliente → Negociação → Produtos → Resumo. Step 3 also has its own cart view. */
type Step = WizardStep;

/** Enough of a customer to display and to send as `customerCode`; a saved/reopened draft never carries the full catalog row. */
type PickedCustomer = Pick<CustomerListItem, "code" | "name"> & Partial<Pick<CustomerListItem, "document" | "tradeName" | "overdue">>;


export interface NewOrderScreenProps {
  readonly repositories: Pick<Repositories, "customers" | "products" | "orders">;
  readonly onUnauthenticated: () => void;
  /**
   * When present, "Salvar" writes the draft to this device (encrypted DB + outbox) and the sync manager delivers it,
   * online or not. Without it the screen keeps its online-only behavior (POST/PUT straight to the API).
   */
  readonly localOrders?: LocalOrdersPort;
  /** A local draft chosen in the "Pedidos" tab; loaded once, then `onResumeConsumed` clears it. */
  readonly resumeLocalId?: string | null;
  readonly onResumeConsumed?: () => void;
  /** "Novo pedido" from a customer sheet: start (or continue) an order for this customer. Handled once per `nonce`. */
  /** With `lines` (a duplicated sale) the cart opens pre-filled as a brand-new order; an order in progress is never replaced silently. */
  readonly startRequest?: { readonly nonce: number; readonly customer: PickedCustomer; readonly lines?: readonly EditorLine[] } | null;
  readonly onStartConsumed?: () => void;
  /** Leaves the wizard back to the sales list. The order in progress stays on this screen (it is only hidden), so nothing is lost. */
  readonly onExit?: () => void;
  /** Filled with the wizard's handle (Back press, save-and-close on tab change); cleared on unmount. */
  readonly controlRef?: MutableRefObject<NewOrderControl | null>;
  /** Post-confirmation "Ver pedido": opens the read-only detail of the confirmed order in the sales list. */
  readonly onViewOrder?: (localId: string) => void;
  /** Post-confirmation "Voltar ao início": goes to the Início tab (the shell applies its tab reset rules). */
  readonly onGoHome?: () => void;
  /** The order's number or stage was refreshed while the screen was open or as it was left: the list reloads. */
  readonly onOrderUpdated?: () => void;
}

/** What the shell can ask of the wizard. */
export interface NewOrderControl {
  /** Android Back: closes a selection, goes back one step, or on the first step asks (when there is unsaved content) and leaves. */
  back(): void;
  /**
   * Leaves the wizard by any path (X, Back on step 1, tab switch, Início). An order with unsaved content asks ONCE ("Descartar o
   * pedido?": Salvar e sair / Descartar / Continuar editando); an empty one leaves with no question and writes nothing.
   * Resolves true once the wizard closed, false when the seller stayed (or a save failed).
   */
  requestLeave(): Promise<boolean>;
}

/**
 * Online-only new-order flow (MOB-4): pick the customer, browse the catalog, edit the cart and save the draft
 * through the same `POST /orders` / `PUT /orders/{id}` the web editor uses. There is no local outbox here
 * (MOB-2/V-09 pending) — a save always needs the server, and every price/total shown is an estimate from
 * `packages/domain`, the server response on save being authoritative (P-09). Negotiation type, notes and bulk
 * entry are out of this slice; reopening an existing draft is only reachable from this screen's own success
 * step (there is no order-list screen yet — see the mobile-engineer report).
 */
export function NewOrderScreen({
  repositories,
  onUnauthenticated,
  localOrders,
  resumeLocalId = null,
  onResumeConsumed,
  startRequest = null,
  onStartConsumed,
  onExit,
  controlRef,
  onViewOrder,
  onGoHome,
  onOrderUpdated,
}: NewOrderScreenProps) {
  const [step, setStep] = useState<Step>("customer");
  /** Step 3 shows either the catalog or the cart as its own view (never both, never a permanent panel). */
  const [productsView, setProductsView] = useState<"catalog" | "cart">("catalog");
  /** Why the seller cannot advance yet; cleared on any step change or edit. */
  const [, setStepError] = useState<string | null>(null);
  const modal = useAppModal();
  const errors = useErrorPopup();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<readonly EditorLine[]>([]);

  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;
  // One idempotency key per distinct payload: a retry after a lost response resends the same key, an edited payload gets a new one.
  // Only `create` uses this: `replace` is optimistic-concurrency based (`expectedVersion`), not idempotency-key based (mirrors web).
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  /** `null` while creating a fresh draft; the loaded order (its id, version, negotiation type and notes) while editing one. */
  const [editingOrder, setEditingOrder] = useState<OrderDetail | null>(null);
  /** Phone-appropriate stand-in for the desktop's checkboxes + toolbar (DISC-1/MOB-4): long-press or this toggle. */
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** The one bulk sheet: every item or one catalog group. */
  const [bulkDiscountOpen, setBulkDiscountOpen] = useState(false);
  /** The same sheet for the lines picked in selection mode. */
  const [selectedDiscountOpen, setSelectedDiscountOpen] = useState(false);
  /** The seller said "Sim" to a discount above a product limit in this session; the saved draft carries it too (`localDraft.discountOverLimitAccepted`). */
  const [discountAccepted, setDiscountAccepted] = useState(false);
  /** The discount field being edited and its value before the edit, so "Não" can put it back. */
  const discountEditRef = useRef<{ key: string; before: string } | null>(null);

  const [config, setConfig] = useState<
    { status: "loading" } | { status: "error"; error: DataErrorInfo } | { status: "ready"; value: OrderEntryConfiguration }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [savedOrder, setSavedOrder] = useState<OrderDetail | null>(null);
  /** The device-local draft being edited (offline-first path); `null` for a fresh order. */
  const [localDraft, setLocalDraft] = useState<DraftRecord | null>(null);
  const [savedLocal, setSavedLocal] = useState<DraftRecord | null>(null);
  /** What "Confirmar" concluded for the order shown on the final screen (`null` = not confirmed). */
  const [confirmResult, setConfirmResult] = useState<ConfirmOutcome | null>(null);
  /** The follow-up budget ran out without a number: the screen shows the neutral "aguardando envio" state (the queue finishes it). */
  const [followExpired, setFollowExpired] = useState(false);
  const orderUpdatedRef = useRef(onOrderUpdated);
  orderUpdatedRef.current = onOrderUpdated;
  // After "Confirmar" the screen keeps asking for the Sankhya number (growing intervals, bounded) and shows it as soon as it exists.
  // Leaving the screen stops the polling and asks once more, so the list already shows the number or the new stage.
  const followId = savedLocal?.localId ?? null;
  const following = followId !== null && confirmResult?.kind === "sending";
  useEffect(() => {
    const read = localOrders?.readOrderNumber;
    if (!following || followId === null || localOrders === undefined || read === undefined) return undefined;
    let active = true;
    let found = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const schedule = () => {
      const delay = followDelay(attempt);
      attempt += 1;
      if (Date.now() - startedAt + delay > FOLLOW_BUDGET_MS) {
        setFollowExpired(true);
        return;
      }
      timer = setTimeout(() => void step(), delay);
    };
    const step = async () => {
      let number: number | null = null;
      try {
        number = await read.call(localOrders, followId);
      } catch {
        // a failed read is just "not yet": the next attempt or the queue completes it
      }
      if (!active) return;
      if (number !== null) {
        found = true;
        setConfirmResult({ kind: "sent", erpNumber: number });
        orderUpdatedRef.current?.();
        return;
      }
      schedule();
    };
    schedule();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      if (!found) {
        void read
          .call(localOrders, followId)
          .then((number) => {
            if (number !== null) orderUpdatedRef.current?.();
          })
          .catch(() => undefined);
      }
    };
  }, [following, followId, localOrders]);
  /** The overlay "Enviando ao Sankhya" while the confirm waits for the answer. */
  const [sendingToErp, setSendingToErp] = useState(false);
  /** Synchronous guard against a double tap on "Confirmar" (state updates are too late for the second tap). */
  const confirmingRef = useRef(false);

  // What the editor held when it was last loaded or saved; an order that differs from it has unsaved edits to protect.
  const baselineRef = useRef(orderSignature(null, []));
  /** Header options the seller changed in this session (`undefined` = untouched, the saved or default value stands). */
  const [choice, setChoice] = useState<{ top?: number; negotiation?: number; carrier?: number | null; freight?: "CIF" | "FOB" | "SEM_FRETE" | null; notes?: string }>({});
  const [carriers, setCarriers] = useState<readonly Carrier[] | null>(null);
  const choiceHeader = { ...(choice.top === undefined ? {} : { top: choice.top }), ...(choice.negotiation === undefined ? {} : { negotiation: choice.negotiation }), ...(choice.carrier === undefined ? {} : { carrier: choice.carrier }), ...(choice.freight === undefined ? {} : { freight: choice.freight }), ...(choice.notes === undefined ? {} : { notes: choice.notes }) };
  const finished = savedLocal !== null || savedOrder !== null;
  /** Never saved on purpose: a fresh order, or one restored from the recovery record. */
  const isNewOrder = localDraft === null || localDraft.kind === "recovery";
  const dirty =
    !finished &&
    orderSignature(customer?.code ?? null, lines, choiceHeader) !== baselineRef.current &&
    (lines.length > 0 || localDraft !== null || editingOrder !== null);

  // Latest cart state for the start-request handler, which must react only to a new request, not to every edit.
  const inProgress = useRef({ customer, lines, finished, dirty });
  useEffect(() => {
    inProgress.current = { customer, lines, finished, dirty };
  });
  const startNonce = startRequest?.nonce ?? null;
  const startCustomer = startRequest?.customer ?? null;
  const startLines = startRequest?.lines;
  useEffect(() => {
    if (startNonce === null || startCustomer === null) return;
    onStartConsumed?.();
    const current = inProgress.current;
    const begin = () => {
      resetOrder();
      setCustomer(startCustomer);
      // The customer is already chosen: the wizard opens on the first step that still needs the seller (Negociação).
      if (startLines === undefined) {
        goToStep("negotiation");
        return;
      }
      setLines(startLines.map((line) => ({ ...line, key: nextKey() })));
      goToStep("summary");
    };
    // Nothing at risk: an empty cart, or an order already saved (its success screen is showing).
    if (current.lines.length === 0 || current.finished) {
      if (current.customer === null && !current.finished) askRecovery(begin);
      else begin();
      return;
    }
    if (startLines === undefined && current.customer?.code === startCustomer.code) {
      goToStep("products");
      return;
    }
    // An order with items is in progress for another customer: never replace it silently.
    modal.show({
      variant: "confirm",
      title: "Você já possui um pedido em andamento",
      message: `Pedido de ${current.customer?.name ?? "outro cliente"} com ${current.lines.length} ${current.lines.length === 1 ? "item" : "itens"}. Iniciar um novo pedido descarta os itens que ainda não foram salvos.`,
      buttons: [
        { label: "Continuar pedido atual", role: "primary", onPress: () => goToStep("products") },
        { label: "Iniciar novo pedido", role: "destructive", onPress: begin },
        { label: "Cancelar", role: "cancel" },
      ],
    });
    // Only a new request (nonce) triggers this; the handlers above read the latest state through refs/closures of this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

  /**
   * An order that was being built when the app closed (recovery record) is offered ONCE when a new order starts on an empty
   * wizard: "Continuar" restores it, "Descartar" deletes it and goes on with `fresh`. Without a record `fresh` runs at once.
   */
  function askRecovery(fresh: () => void) {
    if (localOrders === undefined) {
      fresh();
      return;
    }
    localOrders
      .getRecovery()
      .then((found) => {
        if (found === null) {
          fresh();
          return;
        }
        modal.show({
          variant: "confirm",
          title: "Continuar o pedido em andamento?",
          message: `Pedido de ${found.draft.customerName} que não foi salvo. Continue de onde parou ou descarte para começar outro.`,
          buttons: [
            {
              label: "Continuar",
              role: "primary",
              onPress: () => {
                baselineRef.current = orderSignature(found.draft.customerCode, found.lines);
                setChoice({});
                setLocalDraft(found.draft);
                setCustomer({ code: found.draft.customerCode, name: found.draft.customerName });
                setLines(found.lines);
                setSavedLocal(null);
                setSavedOrder(null);
                setEditingOrder(null);
                goToStep("summary");
              },
            },
            {
              label: "Descartar",
              role: "destructive",
              onPress: () => {
                void localOrders
                  .discardRecovery()
                  .catch(() => undefined)
                  .then(fresh);
              },
            },
          ],
        });
      })
      .catch(() => fresh());
  }
  // Entering the wizard with nothing pending (a plain "Nova venda"): offer the recovery record once.
  const entryAsked = useRef(false);
  useEffect(() => {
    if (entryAsked.current) return;
    entryAsked.current = true;
    if (startRequest !== null || resumeLocalId !== null || localOrders === undefined) return;
    askRecovery(() => undefined);
    // Once per mount: the wizard is mounted whenever a new order is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resumeLocalId === null || localOrders === undefined) return undefined;
    let active = true;
    localOrders
      .open(resumeLocalId)
      .then((opened) => {
        if (!active) return;
        onResumeConsumed?.();
        if (opened === null) return;
        const open = () => {
          baselineRef.current = orderSignature(opened.draft.customerCode, opened.lines);
          setChoice({});
          setLocalDraft(opened.draft);
          setCustomer({ code: opened.draft.customerCode, name: opened.draft.customerName });
          setLines(opened.lines);
          setSavedLocal(null);
          setSavedOrder(null);
          setEditingOrder(null);
          goToStep("summary");
        };
        // Opening another order over unsaved edits would silently throw them away: ask first.
        if (!inProgress.current.dirty) {
          open();
          return;
        }
        modal.show({
          variant: "confirm",
          title: "Há alterações não salvas",
          message: "Abrir outro pedido descarta as alterações do pedido que você está editando.",
          buttons: [
            { label: "Descartar e abrir", role: "destructive", onPress: open },
            { label: "Continuar editando", role: "cancel" },
          ],
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        onResumeConsumed?.();
        errors.report(error, undefined, { title: "Não foi possível abrir o pedido" });
      });
    return () => {
      active = false;
    };
  }, [resumeLocalId, localOrders, onResumeConsumed, errors, modal]);

  useEffect(() => {
    let active = true;
    void loadConfiguration(repositories.orders);
    return () => {
      active = false;
    };

    async function loadConfiguration(orders: OrderRepository) {
      try {
        const value = await orders.getEntryConfiguration();
        if (active) setConfig({ status: "ready", value });
      } catch (error) {
        if (!active) return;
        const info = describeDataError(error);
        if (info.kind === "unauthenticated") {
          onUnauthenticated();
          return;
        }
        setConfig({ status: "error", error: info });
        errors.report(error, { retry: () => void loadConfiguration(orders) }, { title: "Não foi possível carregar os dados do pedido" });
      }
    }
  }, [repositories.orders, onUnauthenticated, errors]);

  const savedTopCode = localDraft?.topCode ?? editingOrder?.topCode ?? null;
  const topCode = choice.top !== undefined ? choice.top : savedTopCode;
  const savedNegotiation =
    localDraft !== null
      ? localDraft.negotiationTypeCode
      : editingOrder !== null
        ? editingOrder.negotiationTypeCode
        : null; // mandatory and chosen by the seller: a new order starts with no negotiation type (owner ruling 2026-11-12)
  const negotiationTypeCode = choice.negotiation !== undefined ? choice.negotiation : savedNegotiation;
  const savedCarrier = localDraft?.carrierCode ?? editingOrder?.carrierCode ?? null;
  const carrierCode = choice.carrier !== undefined ? choice.carrier : savedCarrier;
  const savedFreight = localDraft?.freightType ?? editingOrder?.freightType ?? null;
  const freightType = choice.freight !== undefined ? choice.freight : savedFreight;
  // Shared rule (site, app and server): TOP, negotiation, freight and carrier are mandatory; only the notes are optional.
  const missingHeader = orderHeaderIssues({
    topCode: topCode ?? (config.status === "ready" ? config.value.sales.orderTops.defaultTopCode : null),
    negotiationTypeCode,
    freightType,
    carrierCode,
  });
  const fieldOffsets = useRef<Partial<Record<OrderHeaderIssueCode, number>>>({});
  const negotiationScrollRef = useRef<ScrollView>(null);
  const savedNotes = localDraft !== null ? localDraft.notes : (editingOrder?.notes ?? null);
  const notesText = choice.notes !== undefined ? choice.notes : (savedNotes ?? "");
  /** Empty text is "no notes" (`null`), as before the field existed. */
  const notesValue = notesText.trim() === "" ? null : notesText;

  // Optional list; offline-first adapters answer from what the device stored, and a failure just leaves the choice empty.
  useEffect(() => {
    let active = true;
    repositories.orders
      .listCarriers()
      .then((items) => active && setCarriers(items))
      .catch(() => active && setCarriers([]));
    return () => {
      active = false;
    };
  }, [repositories.orders]);

  const preview = useMemo(() => previewDraft(lines), [lines]);
  const productActions = useMemo<ProductOrderActions>(() => {
    const quantities = new Map(lines.map((line) => [line.productCode, line.quantityText]));
    return { quantityOf: (code) => quantities.get(code), onAdd: addProduct, onDecrement: decrementProduct, onSetQuantity: setProductQuantity };
    // addProduct/decrementProduct only use functional state updates, so they are safe to capture per `lines` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  const blockedLineCount = useMemo(() => {
    if (config.status !== "ready") return 0;
    return preview.lines.filter((linePreview, index) => {
      const state = lines[index]?.price.state;
      return state !== undefined && state === "none" && !isLinePriceOrderable(state, config.value);
    }).length;
  }, [config, preview.lines, lines]);

  function resetOrder() {
    baselineRef.current = orderSignature(null, []);
    setChoice({});
    requestIdRef.current = null;
    setCustomer(null);
    setLines([]);
    setSavedOrder(null);
    setSavedLocal(null);
    setConfirmResult(null);
    setLocalDraft(null);
    setEditingOrder(null);
    setSelectionMode(false);
    setSelected(new Set());
    setDiscountAccepted(false);
    discountEditRef.current = null;
    goToStep("customer");
  }

  function goToStep(next: Step, view: "catalog" | "cart" = "catalog") {
    setStep(next);
    setProductsView(view);
    setStepError(null);
  }

  function setNotes(text: string) {
    setStepError(null);
    setChoice((current) => {
      const { notes: _previous, ...rest } = current;
      return text === (savedNotes ?? "") ? rest : { ...rest, notes: text };
    });
  }

  /** Reopens the just-saved draft for editing (the only entry point this slice has — there is no order-list screen yet). */
  function editSavedOrder(order: OrderDetail) {
    baselineRef.current = orderSignature(order.customerCode, order.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    setChoice({});
    setEditingOrder(order);
    setCustomer({ code: order.customerCode, name: order.customerName });
    setLines(order.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    setSavedOrder(null);
    setSelectionMode(false);
    setSelected(new Set());
    goToStep("summary");
  }

  /** Discards local edits and reloads the authoritative order after a `version_conflict` / `order_not_editable`. */
  async function reload() {
    if (editingOrder === null) return;
    try {
      const fresh = await repositories.orders.get(editingOrder.id);
      baselineRef.current = orderSignature(fresh.customerCode, fresh.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
      setChoice({});
      setEditingOrder(fresh);
      setCustomer({ code: fresh.customerCode, name: fresh.customerName });
      setLines(fresh.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      errors.report(error, { retry: () => void reload() }, { title: "Não foi possível recarregar" });
    }
  }

  /** Throws away the order being edited (never a saved draft: that one stays on the device). Always asks first. */
  function confirmDiscard() {
    const saved = (localDraft !== null && localDraft.kind !== "recovery") || editingOrder !== null;
    modal.show({
      variant: "confirm",
      title: saved ? "Descartar alterações?" : "Descartar pedido?",
      message: saved
        ? "As alterações feitas desde o último salvamento serão perdidas. O pedido salvo continua como estava."
        : "Os itens do carrinho serão removidos e o pedido não será salvo. Esta ação não pode ser desfeita.",
      buttons: [
        {
          label: "Descartar",
          role: "destructive",
          onPress: () => {
            if (!saved) void localOrders?.discardRecovery().catch(() => undefined);
            resetOrder();
          },
        },
        { label: "Continuar editando", role: "cancel" },
      ],
    });
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelected(new Set());
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  function toggleSelect(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Long-pressing a line enters selection mode and selects it in one gesture. */
  function enterSelectionWith(key: string) {
    setSelectionMode(true);
    setSelected(new Set([key]));
  }

  /** Picking in step 1. Choosing another customer over a filled cart asks first, because the cart is emptied. */
  function selectCustomer(picked: PickedCustomer) {
    setStepError(null);
    if (customer === null || customer.code === picked.code || lines.length === 0) {
      setCustomer(picked);
      goToStep("negotiation");
      return;
    }
    modal.show({
      variant: "confirm",
      title: "Trocar de cliente?",
      message: "Os produtos já adicionados serão removidos do pedido.",
      buttons: [
        {
          label: "Continuar",
          role: "destructive",
          onPress: () => {
            setLines([]);
            setCustomer(picked);
            goToStep("negotiation");
          },
        },
        { label: "Cancelar", role: "cancel" },
      ],
    });
  }

  /** Message for the first thing missing in `from`, or `null` when the seller may advance. Presentation only: the server still revalidates everything. */
  function validateStep(from: Step): string | null {
    if (from === "customer") return customer === null ? "Selecione um cliente para continuar." : null;
    if (from === "negotiation") {
      if (missingHeader.length > 0) {
        const first = missingHeader[0];
        const offset = first === undefined ? undefined : fieldOffsets.current[first];
        if (offset !== undefined) negotiationScrollRef.current?.scrollTo({ y: Math.max(0, offset - 8), animated: true });
        return `Preencha para continuar: ${missingHeader.map((code) => ORDER_HEADER_ISSUE_LABEL[code]).join(", ")}.`;
      }
      return notesText.length > NOTES_MAX ? `As observações aceitam até ${NOTES_MAX} caracteres.` : null;
    }
    if (from === "products") {
      if (lines.length === 0) return "Adicione ao menos um produto para continuar.";
      if (!preview.valid) return "Corrija a quantidade ou o desconto dos itens do carrinho para continuar.";
      if (blockedLineCount > 0) return blockedItemsMessage(blockedLineCount);
    }
    return null;
  }

  function goNext() {
    const message = validateStep(step);
    if (message !== null) {
      setStepError(message);
      modal.show({ variant: "error", title: "Falta algo", message });
      return;
    }
    const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1];
    if (next === undefined) return;
    void autoSave();
    goToStep(next);
  }

  function goBack() {
    const previous = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1];
    if (previous === undefined) return;
    void autoSave();
    goToStep(previous);
  }

  function addProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (existing) return current.map((line) => (line.key === existing.key ? incrementLineQuantity(line) : line));
      return [...current, lineFromProduct(product, nextKey())];
    });
  }

  function decrementProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (!existing) return current;
      const step = decrementLineQuantity(existing);
      if (step === null) return current;
      if (step.kind === "remove") return current.filter((line) => line.key !== existing.key);
      return current.map((line) => (line.key === existing.key ? { ...line, quantityText: step.quantityText } : line));
    });
  }

  /** A quantity typed in the catalog field (already validated by `commitQuantityText`); zero takes the product out like "−" at the minimum. */
  function setProductQuantity(product: ProductListItem, result: { kind: "set"; quantityText: string } | { kind: "remove" }) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (!existing) return current;
      if (result.kind === "remove") return current.filter((line) => line.key !== existing.key);
      return current.map((line) => (line.key === existing.key ? { ...line, quantityText: result.quantityText } : line));
    });
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
    setSelected((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function setQuantityText(key: string, text: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, quantityText: text } : line)));
  }

  /** Marked once the seller accepted a discount above a limit (this session or a saved draft): no further question in this order. */
  const overLimitAccepted = discountAccepted || (localDraft?.discountOverLimitAccepted ?? false) || editingOrder?.discountAboveLimitAccepted === true;
  const latest = useRef({ lines, overLimitAccepted });
  latest.current = { lines, overLimitAccepted };

  function setDiscountText(key: string, text: string) {
    // The first change of an edit remembers the value before it, for "Não".
    if (discountEditRef.current?.key !== key) {
      discountEditRef.current = { key, before: latest.current.lines.find((line) => line.key === key)?.discountText ?? "" };
    }
    setLines((current) => current.map((line) => (line.key === key ? { ...line, discountText: text } : line)));
  }

  const OVER_LIMIT_QUESTION = "Esse desconto é acima do liberado. Tem certeza que deseja utilizar essa %?";

  /** One question, "Sim" / "Não", in the app's own dialog; resolves true on "Sim". */
  function askOverLimit(details?: { message: string; list: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      modal.show({
        variant: "confirm",
        title: OVER_LIMIT_QUESTION,
        ...(details === undefined ? {} : { message: details.message, details: details.list, detailsLabel: "Ver itens acima do limite", detailsPlain: true }),
        buttons: [
          { label: "Sim", role: "primary", onPress: () => resolve(true) },
          { label: "Não", role: "cancel", onPress: () => resolve(false) },
        ],
      });
    });
  }

  /** The item discount field was left: asks once per order when the typed percentage is above the product limit. */
  function commitDiscount(key: string) {
    const edit = discountEditRef.current;
    if (edit === null || edit.key !== key) return;
    discountEditRef.current = null;
    const line = latest.current.lines.find((candidate) => candidate.key === key);
    if (line === undefined || latest.current.overLimitAccepted || !discountExceedsLimit(line)) return;
    void askOverLimit().then((yes) => {
      if (yes) setDiscountAccepted(true);
      else setLines((current) => current.map((candidate) => (candidate.key === key ? { ...candidate, discountText: edit.before } : candidate)));
    });
  }

  /** A bulk / group / selection apply: applies at once when nothing is above a limit (or the order is already marked); otherwise asks once. */
  function applyBulk(before: readonly EditorLine[], after: EditorLine[], close: () => void) {
    const { over, within } = bulkOverLimit(before, after);
    if (over.length === 0 || latest.current.overLimitAccepted) {
      setLines(after);
      close();
      return;
    }
    const list = over.map((item) => `${item.description}: máx. ${item.limit}%, digitado ${item.typed}%`).join("\n");
    void askOverLimit({ message: `${within} ${within === 1 ? "item dentro do limite" : "itens dentro do limite"} · ${over.length} ${over.length === 1 ? "item acima" : "itens acima"}`, list }).then((yes) => {
      if (!yes) return;
      setDiscountAccepted(true);
      setLines(after);
      close();
    });
  }

  /** Writes the order to this device (same path as "Salvar"); returns the stored draft. */
  async function persistLocal(port: LocalOrdersPort, picked: PickedCustomer, sendRequested?: boolean, recovery = false): Promise<DraftRecord> {
    const saved = await port.save({
      ...(sendRequested === undefined ? {} : { sendRequested }),
      ...(recovery ? { recovery: true } : {}),
      localId: localDraft?.localId ?? null,
      customer: picked,
      negotiationTypeCode,
      topCode,
      carrierCode,
      freightType,
      notes: notesValue,
      lines,
      loadedDataset: config.status === "ready" ? datasetIdentityOf(config.value) : null,
      ...(overLimitAccepted ? { discountOverLimitAccepted: true } : {}),
    });
    baselineRef.current = orderSignature(picked.code, lines);
    setChoice({});
    setLocalDraft(saved);
    return saved;
  }

  /**
   * Silent protection against a forced close between steps and when the app goes to the background. It writes a RECOVERY record
   * only (invisible in the list, never sent, never counted) and only for an order that was never saved: an order saved on purpose
   * is changed only by "Salvar e sair" or "Confirmar". Only a complete, valid cart is stored; a failure stays silent.
   */
  async function autoSave() {
    if (localOrders === undefined || customer === null || saving || finished || !dirty || !isNewOrder) return;
    if (lines.length === 0 || !preview.valid || blockedLineCount > 0) return;
    try {
      await persistLocal(localOrders, customer, undefined, true);
    } catch {
      // The explicit save reports the problem.
    }
  }

  // The app-state listener must call the latest closure (current lines/choice), never a stale one.
  const autoSaveRef = useRef(autoSave);
  useEffect(() => {
    autoSaveRef.current = autoSave;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void autoSaveRef.current();
    });
    return () => subscription.remove();
  }, []);

  /**
   * "Salvar e sair": keeps the order on this device (never asks Sankhya, never writes a send request) and leaves. Nothing is written
   * for an empty order (no customer and no items). A failed save keeps the seller on the screen with the reason.
   */
  async function saveAndExit(): Promise<boolean> {
    if (!finished && localOrders !== undefined && customer !== null && (isNewOrder || dirty)) {
      try {
        // Not a recovery save: this creates (or promotes the recovery to) the saved order.
        await persistLocal(localOrders, customer);
      } catch (error) {
        errors.report(error, { retry: () => void saveAndExit() }, { title: "Não foi possível salvar" });
        return false;
      }
    }
    resetOrder();
    onExit?.();
    return true;
  }

  /** Guards against a second "Descartar o pedido?" while one is open (double tap, Back plus tab). */
  const leaveAskedRef = useRef(false);

  /**
   * Every way out of the wizard goes through here. An order with unsaved content asks once; an empty order (or one with nothing
   * unsaved, or one already confirmed) leaves with no question. Nothing is written for an empty order.
   */
  function requestLeave(): Promise<boolean> {
    if (leaveAskedRef.current) return Promise.resolve(false);
    const port = localOrders;
    const unsaved = !finished && port !== undefined && editingOrder === null && (isNewOrder ? customer !== null || lines.length > 0 : dirty);
    if (!unsaved) {
      // Emptied after a recovery write: nothing left to protect.
      if (!finished && port !== undefined && localDraft?.kind === "recovery") void port.discardRecovery().catch(() => undefined);
      resetOrder();
      onExit?.();
      return Promise.resolve(true);
    }
    leaveAskedRef.current = true;
    return new Promise<boolean>((resolve) => {
      const done = (left: boolean) => {
        leaveAskedRef.current = false;
        resolve(left);
      };
      modal.show({
        variant: "confirm",
        title: "Descartar o pedido?",
        message: isNewOrder
          ? "Este pedido ainda não foi salvo. Salve para continuar depois ou descarte para apagá-lo."
          : "As alterações feitas desde o último salvamento serão perdidas. O pedido salvo continua como estava.",
        buttons: [
          { label: "Salvar e sair", role: "primary", onPress: () => void saveAndExit().then(done) },
          {
            label: "Descartar",
            role: "destructive",
            onPress: () => {
              if (isNewOrder) void localOrders?.discardRecovery().catch(() => undefined);
              resetOrder();
              onExit?.();
              done(true);
            },
          },
          { label: "Continuar editando", role: "cancel", onPress: () => done(false) },
        ],
      });
    });
  }

  /** Android Back inside the wizard: selection first, then one step back; on the first step (or the final screen) leave (asks when unsaved). */
  function handleBack() {
    if (selectionMode) {
      cancelSelection();
      return;
    }
    if (finished) {
      void requestLeave();
      return;
    }
    if (step === "products" && productsView === "cart") {
      setProductsView("catalog");
      return;
    }
    if (WIZARD_STEPS.indexOf(step) <= 0) {
      void requestLeave();
      return;
    }
    goBack();
  }
  const controlLatest = useRef({ back: handleBack, requestLeave });
  useEffect(() => {
    controlLatest.current = { back: handleBack, requestLeave };
  });
  useEffect(() => {
    if (controlRef === undefined) return undefined;
    controlRef.current = { back: () => controlLatest.current.back(), requestLeave: () => controlLatest.current.requestLeave() };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

  /** The popup action handlers of a definitive refusal: each takes the seller to the step that fixes it. */
  function refusalHandlers() {
    return {
      change_customer: () => goToStep("customer"),
      remove_item: () => {
        setProductsView("cart");
        goToStep("products");
      },
      edit_items: () => {
        setProductsView("cart");
        goToStep("products");
      },
      edit_header: () => goToStep("negotiation"),
      reload: () => void reload(),
    };
  }

  /** "Tentar de novo" on the Sankhya-unavailable popup: asks for the delivery again; the screen follows the new outcome. */
  async function resendQueued(localId: string) {
    if (localOrders === undefined || confirmingRef.current) return;
    confirmingRef.current = true;
    setSendingToErp(true);
    try {
      let outcome: ConfirmOutcome = { kind: "queued" };
      try {
        outcome = (await localOrders.confirm?.(localId)) ?? outcome;
      } catch {
        // still queued: it is resent by itself
      }
      const latest = await localOrders.get(localId);
      if (latest !== null) {
        setLocalDraft(latest);
        setSavedLocal(latest);
      }
      if (outcome.kind === "refused") {
        const code = outcome.code ?? codeOfHeldMessage(outcome.message) ?? "validation_failed";
        errors.reportCode(code, refusalHandlers(), outcome.message ?? undefined);
        return;
      }
      setConfirmResult(outcome);
      if (outcome.kind === "queued") {
        errors.reportCode(outcome.reason === "sankhya_unavailable" ? "sankhya_unavailable" : "order_queued", outcome.reason === "sankhya_unavailable" ? { retry: () => void resendQueued(localId) } : {}, undefined, {
          ...(outcome.reason === "sankhya_unavailable" ? {} : { title: `${kindTitle} não enviado ao Sankhya` }),
          message: `O ${kindWord} ficou salvo neste aparelho e será enviado assim que possível.`,
        });
      }
    } finally {
      confirmingRef.current = false;
      setSendingToErp(false);
    }
  }

  /**
   * "Confirmar" concludes the order: saves it on the device with the send request, tries to deliver it to Sankhya right away and waits a
   * few seconds for the number. Transient failure: it stays queued and is resent by itself. Definitive refusal: popup with the fix, the
   * order stays editable and is NOT resent.
   */
  async function confirmOrder() {
    if (customer === null || confirmingRef.current || localOrders === undefined) return;
    confirmingRef.current = true;
    setSaving(true);
    try {
      let saved: DraftRecord;
      try {
        saved = await persistLocal(localOrders, customer, true);
      } catch (error) {
        errors.report(
          error,
          { retry: () => void confirmOrder() },
          {
            title: "Não foi possível confirmar",
            ...(error instanceof DatasetUnavailableError || error instanceof DatasetChangedError
              ? {}
              : { message: "Este pedido não pode mais ser alterado aqui. Abra-o em Vendas para ver a situação." }),
          },
        );
        return;
      }
      setSendingToErp(true);
      let outcome: ConfirmOutcome = { kind: "queued" };
      try {
        outcome = (await localOrders.confirm?.(saved.localId)) ?? outcome;
      } catch {
        // Whatever failed, the order is saved and queued: it is resent by itself.
      } finally {
        setSendingToErp(false);
      }
      const latest = (await localOrders.get(saved.localId)) ?? saved;
      setLocalDraft(latest);
      if (outcome.kind === "refused") {
        const code = outcome.code ?? codeOfHeldMessage(outcome.message) ?? "validation_failed";
        const useText = code === "validation_failed" || code === "header_not_eligible";
        errors.reportCode(code, refusalHandlers(), outcome.message ?? undefined, useText && outcome.message !== null ? { message: outcome.message } : undefined);
        return;
      }
      if (outcome.kind === "queued") {
        if (outcome.reason === "sankhya_unavailable") {
          // 503/500/429: transient. The order stays queued and is resent; "Tentar de novo" asks again right away.
          errors.reportCode("sankhya_unavailable", { retry: () => void resendQueued(saved.localId) }, undefined, {
            message: `O ${kindWord} ficou salvo neste aparelho e será enviado assim que o Sankhya voltar.`,
          });
        } else {
          errors.reportCode("order_queued", {}, undefined, { title: `${kindTitle} não enviado ao Sankhya`, message: `O ${kindWord} ficou salvo neste aparelho e será enviado assim que possível.` });
        }
      }
      setFollowExpired(false);
      setConfirmResult(outcome);
      setSavedLocal(latest);
    } finally {
      confirmingRef.current = false;
      setSaving(false);
    }
  }

  /** Online-only path (no local database wired): creates or replaces the server draft. */
  async function save() {
    if (customer === null || saving) return;
    setSaving(true);
    try {
      // The server compares this with its own dataset before any write: it states the dataset this editor loaded under.
      // Without it nothing is sent (never "whatever is current at POST time").
      const expectedDataset = config.status === "ready" ? datasetIdentityOf(config.value) : null;
      if (expectedDataset === null) throw new DatasetUnavailableError();
      const body = {
        expectedDataset,
        customerCode: customer.code,
        // Editing an existing draft keeps its negotiation type and notes as loaded (not editable in this slice);
        // a fresh draft uses the installation default.
        negotiationTypeCode,
        ...(topCode === null ? {} : { topCode }),
        ...(carrierCode === null && (editingOrder?.carrierCode ?? null) === null ? {} : { carrierCode }),
        ...(freightType === null ? {} : { freightType }),
        notes: notesValue,
        ...(overLimitAccepted ? { discountAboveLimitAccepted: true } : {}),
        items: toRequestItems(lines),
      };
      if (editingOrder !== null) {
        const updated = await repositories.orders.replace(editingOrder.id, { expectedVersion: editingOrder.version, ...body });
        setEditingOrder(updated);
        setSavedOrder(updated);
      } else {
        const payload = JSON.stringify(body);
        if (requestIdRef.current?.payload !== payload) {
          requestIdRef.current = { payload, id: newClientRequestId() };
        }
        const created = await repositories.orders.create({ clientRequestId: requestIdRef.current.id, ...body });
        setSavedOrder(created);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      errors.report(error, { retry: () => void save(), reload: () => void reload(), change_customer: () => goToStep("customer") });
    } finally {
      setSaving(false);
    }
  }

  // Quotation vs order comes from the installation's configured quotation TOP (never a literal code).
  const salesConfig = config.status === "ready" ? config.value.sales : null;
  const isQuotation = salesConfig !== null && isQuotationTop(topCode ?? salesConfig.orderTops.defaultTopCode, salesConfig.orderTops);
  const kindWord = isQuotation ? "orçamento" : "pedido";
  const kindTitle = isQuotation ? "Orçamento" : "Pedido";

  if (savedLocal !== null) {
    const result = confirmResult;
    const waiting = result?.kind === "sending" && !followExpired;
    const title =
      result?.kind === "sent"
        ? `${kindTitle} enviado`
        : waiting
          ? "Enviando ao Sankhya"
          : result?.kind === "awaiting_approval"
            ? "Aguardando aprovação"
            : `${kindTitle} aguardando envio`;
    // Confirmed orders are blocked for editing (owner 2026-11-23); only a discount waiting for approval can go back to editing.
    const readOnly = result?.kind !== "awaiting_approval";
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>{title}</Text>
        <Text style={styles.successMeta}>{savedLocal.customerName}</Text>
        {result?.kind === "sent" && <Text style={styles.successTotal}>{orderIdentity(result.erpNumber, isQuotation)}</Text>}
        {waiting && <ActivityIndicator color={colors.navy} accessibilityLabel="Enviando ao Sankhya" />}
        <View style={styles.actions}>
          {onViewOrder !== undefined && (
            <Pressable style={styles.primaryButton} onPress={() => onViewOrder(savedLocal.localId)} accessibilityRole="button" accessibilityLabel="Ver pedido">
              <Text style={styles.primaryButtonText}>Ver pedido</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
            <Text style={styles.secondaryButtonText}>Novo pedido</Text>
          </Pressable>
          {onGoHome !== undefined && (
            <Pressable style={styles.secondaryButton} onPress={onGoHome} accessibilityRole="button" accessibilityLabel="Voltar ao início">
              <Text style={styles.secondaryButtonText}>Voltar ao início</Text>
            </Pressable>
          )}
          {!readOnly && (
            <Pressable style={styles.secondaryButton} onPress={() => { setSavedLocal(null); setConfirmResult(null); }} accessibilityRole="button" accessibilityLabel="Editar pedido">
              <Text style={styles.secondaryButtonText}>Editar pedido</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (savedOrder !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>{editingOrder !== null ? "Alterações salvas" : `${kindTitle} salvo`}</Text>
        <Text style={styles.successMeta}>{savedOrder.customerName}</Text>
        <Text style={styles.successTotal}>{formatBrl(savedOrder.estimatedTotal) ?? "—"}</Text>
        {savedOrder.isPartial && <Text style={styles.partialNotice}>Total parcial: há itens sem preço neste pedido.</Text>}
        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
            <Text style={styles.primaryButtonText}>Novo pedido</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => editSavedOrder(savedOrder)}
            accessibilityRole="button"
            accessibilityLabel="Editar pedido"
          >
            <Text style={styles.secondaryButtonText}>Editar pedido</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const orderable = lines.length > 0 && preview.valid && blockedLineCount === 0;
  const total = formatBrl(preview.ipi.grandTotalEstimated) ?? "—";
  const itemsInfo = `${lines.length} ${lines.length === 1 ? "item" : "itens"} · ${total}`;
  const saveLabel = "Confirmar";

  // Negociação: "Próximo" stays off until every mandatory field is filled (the missing ones are highlighted in the form).
  const nextBlocked =
    (step === "customer" && customer === null) ||
    (step === "negotiation" && (config.status !== "ready" || missingHeader.length > 0 || notesText.length > NOTES_MAX));

  function renderCustomerStep() {
    return (
      <View style={styles.flex}>
        {customer !== null && (
          <View style={styles.selectedCustomer} accessibilityLabel={`Cliente selecionado: ${customer.name}`}>
            <Text style={styles.selectedCaption}>Cliente selecionado</Text>
            <Text style={styles.selectedName}>{customer.name}</Text>
            <Text style={styles.selectedMeta}>{`Código ${customer.code}${customer.document != null ? ` · ${customer.document}` : ""}`}</Text>
            {customer.overdue === true && <Text style={styles.selectedWarn}>Possui títulos vencidos (informativo)</Text>}
          </View>
        )}
        {editingOrder !== null ? (
          <Text style={styles.lockedNote}>O cliente de um pedido já salvo não pode ser trocado. Para outro cliente, inicie um novo pedido.</Text>
        ) : (
          <>
            <Text style={styles.stepTitle}>{customer === null ? "Selecione o cliente" : "Trocar de cliente"}</Text>
            <CustomerPicker customers={repositories.customers} onSelect={selectCustomer} onUnauthenticated={onUnauthenticated} />
          </>
        )}
      </View>
    );
  }

  function renderNegotiationStep() {
    return (
      <ScrollView ref={negotiationScrollRef} style={styles.flex} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {config.status === "loading" && <Text style={styles.lockedNote}>Carregando as opções do pedido…</Text>}
        {config.status === "error" && <Text style={styles.footerNotice}>{config.error.message}</Text>}
        {config.status === "ready" && (
          <OrderHeaderOptions
            sales={config.value.sales}
            topCode={topCode}
            negotiationTypeCode={negotiationTypeCode}
            onTopChange={(code) => setChoice((current) => ({ ...current, top: code }))}
            onNegotiationChange={(code) => setChoice((current) => ({ ...current, negotiation: code }))}
            carriers={carriers}
            carrierCode={carrierCode}
            onCarrierChange={(code) => setChoice((current) => ({ ...current, carrier: code }))}
            freightType={freightType}
            onFreightChange={(value) => setChoice((current) => ({ ...current, freight: value }))}
            missing={missingHeader}
            showMissing
            onFieldOffset={(code, y) => {
              fieldOffsets.current[code] = y;
            }}
          />
        )}
        <NotesField value={notesText} onChange={setNotes} />
      </ScrollView>
    );
  }

  function renderProductsStep() {
    return (
      <View style={styles.flex}>
        <View style={styles.pills} accessibilityRole="tablist">
          <Pressable
            style={[styles.pill, productsView === "catalog" && styles.pillActive]}
            onPress={() => setProductsView("catalog")}
            accessibilityRole="tab"
            accessibilityState={{ selected: productsView === "catalog" }}
            accessibilityLabel="Produtos"
          >
            <Icon name="products" size={20} color={productsView === "catalog" ? colors.onNavy : colors.textMuted} />
            <Text style={[styles.pillText, productsView === "catalog" && styles.pillTextActive]}>Produtos</Text>
          </Pressable>
          <Pressable
            style={[styles.pill, productsView === "cart" && styles.pillActive]}
            onPress={() => setProductsView("cart")}
            accessibilityRole="tab"
            accessibilityState={{ selected: productsView === "cart" }}
            accessibilityLabel={`Carrinho${lines.length > 0 ? ` (${lines.length})` : ""}`}
          >
            <Icon name="cart" size={20} color={productsView === "cart" ? colors.onNavy : colors.textMuted} />
            <Text style={[styles.pillText, productsView === "cart" && styles.pillTextActive]}>Carrinho</Text>
            {lines.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{lines.length}</Text>
              </View>
            )}
          </Pressable>
        </View>
        {/* Kept mounted (only hidden) in the cart view, so the catalog search, filters and Grade/Lista survive the round trip. */}
        <View style={productsView === "catalog" ? styles.flex : styles.hidden}>
          <ProductPicker products={repositories.products} customerCode={customer?.code} actions={productActions} onUnauthenticated={onUnauthenticated} />
        </View>
        {productsView === "cart" && (
          <View style={styles.flex}>
            {lines.length > 0 && (
              <View style={styles.cartToolbar}>
                <Pressable
                  style={styles.toolbarButton}
                  onPress={toggleSelectionMode}
                  accessibilityRole="button"
                  accessibilityLabel={selectionMode ? "Cancelar seleção" : "Selecionar itens"}
                >
                  <Icon name={selectionMode ? "close" : "select"} size={18} color={colors.navy} />
                  <Text style={styles.toolbarButtonText} numberOfLines={1}>{selectionMode ? "Cancelar" : "Selecionar"}</Text>
                </Pressable>
                {selectionMode ? (
                  <Pressable
                    style={[styles.toolbarButton, selected.size === 0 && styles.toolbarButtonDisabled]}
                    onPress={() => setSelectedDiscountOpen(true)}
                    disabled={selected.size === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Aplicar desconto aos selecionados"
                  >
                    <Text style={styles.toolbarIcon}>%</Text>
                    <Text style={styles.toolbarButtonText} numberOfLines={1}>{`Desconto (${selected.size})`}</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable style={styles.toolbarButton} onPress={() => setBulkDiscountOpen(true)} accessibilityRole="button" accessibilityLabel="Desconto em lote">
                      <Text style={styles.toolbarIcon}>%</Text>
                      <Text style={styles.toolbarButtonText} numberOfLines={1}>Desc. em lote</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
            <CartView
              lines={lines}
              preview={preview}
              onQuantityChange={setQuantityText}
              onDiscountChange={setDiscountText}
              onDiscountCommit={commitDiscount}
              onRemove={removeLine}
              selectionMode={selectionMode}
              selected={selected}
              onToggleSelect={toggleSelect}
              onLongPressLine={enterSelectionWith}
            />
          </View>
        )}
      </View>
    );
  }

  function renderSummaryStep() {
    const sales = config.status === "ready" ? config.value.sales : null;
    const effectiveTop = topCode ?? sales?.orderTops.defaultTopCode ?? null;
    const negotiationName = negotiationTypeCode === null ? null : (sales?.negotiationTypes.find((type) => type.code === negotiationTypeCode)?.label ?? `Código ${negotiationTypeCode}`);
    const carrierName = carrierCode === null ? null : (carriers?.find((carrier) => carrier.code === carrierCode)?.name ?? `Transportadora ${carrierCode}`);
    const freightLabel = freightType === null ? null : freightType === "SEM_FRETE" ? "Sem frete" : freightType;
    const hasDiscount = (text: string) => text.trim() !== "" && Number(text.replace(",", ".")) > 0;
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <SummaryBlock title="Cliente" editLabel="Editar cliente" onEdit={editingOrder === null ? () => goToStep("customer") : undefined}>
          <Text style={styles.summaryStrong}>{customer?.name}</Text>
          {customer !== null && <Text style={styles.summaryMeta}>{`Código ${customer.code}${customer.document != null ? ` · ${customer.document}` : ""}`}</Text>}
        </SummaryBlock>

        <SummaryBlock title="Negociação" editLabel="Editar negociação" onEdit={() => goToStep("negotiation")}>
          {sales !== null && effectiveTop !== null && <SummaryRow label="Operação" value={topLabel(effectiveTop, sales.orderTops)} />}
          <SummaryRow label="Negociação" value={negotiationName ?? "Não informada"} />
          <SummaryRow label="Frete" value={freightLabel ?? "Não informado"} />
          <SummaryRow label="Transportadora" value={carrierName ?? "Não informada"} />
          {missingHeader.length > 0 && (
            <Text style={styles.footerNotice}>{`Falta preencher para enviar: ${missingHeader.map((code) => ORDER_HEADER_ISSUE_LABEL[code]).join(", ")}.`}</Text>
          )}
          <SummaryRow label="Observações" value={notesValue ?? "—"} />
        </SummaryBlock>

        <SummaryBlock title={`Produtos (${lines.length})`} editLabel="Editar produtos" onEdit={() => goToStep("products", "cart")}>
          {lines.length === 0 && <Text style={styles.summaryMeta}>Nenhum item no carrinho.</Text>}
          {lines.map((line, index) => {
            const amounts = lineAmountsOf(preview.lines[index] ?? { key: line.key, item: null });
            return (
              <View key={line.key} style={styles.summaryLine}>
                <Thumb code={line.productCode} description={line.description} version={line.imageVersion} size="row" />
                <View style={styles.flex}>
                  <Text style={styles.summaryStrong} numberOfLines={2}>{line.description}</Text>
                  <Text style={styles.summaryMeta}>{`${line.quantityText.trim()} ${line.unit} × ${describeListPrice(line.price)}`}</Text>
                  {hasDiscount(line.discountText) && (
                    <Text style={styles.summaryDiscount}>
                      {`Desconto ${line.discountText.trim().replace(/\s*%$/, "")}%${amounts.discountAmount !== null && amounts.discountAmount !== "0" && amounts.discountAmount !== "0.00" ? ` · − ${formatBrl(amounts.discountAmount) ?? "—"}` : ""}`}
                    </Text>
                  )}
                </View>
                <Text style={styles.summaryStrong}>{amounts.lineTotal === null ? "—" : (formatBrl(amounts.lineTotal) ?? "—")}</Text>
              </View>
            );
          })}
        </SummaryBlock>

        <OrderTotals preview={preview} />

        {config.status === "error" && <Text style={styles.footerNotice}>{config.error.message}</Text>}
        {lines.length > 0 && !preview.valid && <Text style={styles.footerNotice}>Há quantidade ou desconto inválido no carrinho. Corrija em Produtos.</Text>}
        {blockedLineCount > 0 && (
          <Text style={styles.footerNotice}>{blockedItemsMessage(blockedLineCount)}</Text>
        )}
        {dirty && !saving && (
          <Pressable style={styles.discardButton} onPress={confirmDiscard} accessibilityRole="button" accessibilityLabel="Descartar">
            <Text style={styles.discardButtonText}>{localDraft !== null || editingOrder !== null ? "Descartar alterações" : "Descartar pedido"}</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.flex}>
      <WizardProgress step={step} customerName={step === "customer" ? undefined : customer?.name} onExit={onExit === undefined ? undefined : () => void requestLeave()} />
      {step === "customer" && renderCustomerStep()}
      {step === "negotiation" && renderNegotiationStep()}
      {step === "products" && renderProductsStep()}
      {step === "summary" && renderSummaryStep()}

      {step === "summary" ? (
        localOrders !== undefined ? (
          <WizardFooter
            onBack={goBack}
            onNext={() => void confirmOrder()}
            nextLabel={saveLabel}
            nextDisabled={!orderable || saving}
            busy={saving}
            {...(onExit === undefined ? {} : { secondaryLabel: "Salvar e sair", onSecondary: () => void saveAndExit() })}
          />
        ) : (
          <WizardFooter onBack={goBack} onNext={() => void save()} nextLabel={saveLabel} nextDisabled={!orderable || saving} busy={saving} />
        )
      ) : (
        <WizardFooter
          onBack={step === "customer" ? null : goBack}
          onNext={goNext}
          nextLabel="Próximo"
          nextDisabled={nextBlocked}
          info={step === "products" ? itemsInfo : undefined}
        />
      )}

      <BulkDiscountSheet
        visible={bulkDiscountOpen}
        lines={lines}
        products={repositories.products}
        onApply={(before, after) => applyBulk(before, after, () => setBulkDiscountOpen(false))}
        onClose={() => setBulkDiscountOpen(false)}
      />
      <BulkDiscountSheet
        visible={selectedDiscountOpen}
        lines={lines}
        products={repositories.products}
        selectedKeys={selected}
        onApply={(before, after) =>
          applyBulk(before, after, () => {
            setSelectedDiscountOpen(false);
            cancelSelection();
          })
        }
        onClose={() => setSelectedDiscountOpen(false)}
      />
      {sendingToErp && (
        <View style={styles.sendingOverlay} accessibilityViewIsModal accessibilityLiveRegion="polite" accessibilityLabel="Enviando ao Sankhya">
          <View style={styles.sendingCard}>
            <ActivityIndicator color={colors.navy} />
            <Text style={styles.sendingText}>Enviando ao Sankhya</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  stepError: { fontSize: 13, fontWeight: "600", color: colors.text, backgroundColor: colors.errorBackground, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  selectedCustomer: { margin: spacing.md, marginBottom: 0, padding: spacing.md, borderRadius: 8, borderWidth: 2, borderColor: colors.navy, backgroundColor: colors.surface, gap: 2 },
  selectedCaption: { fontSize: 11, color: colors.textMuted },
  selectedName: { fontSize: 16, fontWeight: "800", color: colors.text },
  selectedMeta: { fontSize: 13, color: colors.textMuted },
  selectedWarn: { fontSize: 12, fontWeight: "700", color: colors.warning },
  lockedNote: { fontSize: 13, color: colors.textMuted, padding: spacing.lg },
  summaryStrong: { fontSize: 14, fontWeight: "700", color: colors.text },
  summaryMeta: { fontSize: 12, color: colors.textMuted },
  summaryDiscount: { fontSize: 12, color: colors.red, fontWeight: "600" },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.xs },
  hidden: { display: "none" },
  sendingOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  sendingCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderRadius: 12, backgroundColor: colors.surface },
  sendingText: { fontSize: 16, fontWeight: "700", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  stepTitle: { fontSize: 16, fontWeight: "700", color: colors.text, padding: spacing.lg, paddingBottom: 0 },
  pills: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  pill: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.background },
  pillActive: { backgroundColor: colors.navy },
  pillText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: colors.onNavy },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.onNavy, fontSize: 11, fontWeight: "800" },
  cartToolbar: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  // One row of equal buttons (icon + short label), each at least 44 high: the full wording lives in accessibilityLabel.
  toolbarButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  toolbarButtonDisabled: { opacity: 0.5 },
  toolbarIcon: { color: colors.navy, fontWeight: "800", fontSize: 15 },
  toolbarButtonText: { color: colors.navy, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  footerNotice: { fontSize: 12, color: colors.warning },
  footerInfo: { fontSize: 12, color: colors.textMuted },
  discardButton: { alignItems: "center", paddingVertical: spacing.sm },
  discardButtonText: { color: colors.red, fontWeight: "700", fontSize: 13 },
  failureBox: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.md, gap: 2 },
  failureTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  failureMessage: { fontSize: 13, color: colors.text },
  reloadLink: { color: colors.navy, fontWeight: "700", fontSize: 13, marginTop: spacing.xs },
  // The buttons fill the width of the screen (never shrink to the text) and share the app's radius and height tokens.
  actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.md },
  primaryButton: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: control.heightLarge,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700", textAlign: "center" },
  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.navy,
    minHeight: control.heightLarge,
  },
  secondaryButtonText: { color: colors.navy, fontSize: 15, fontWeight: "700" },
  successTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  successMeta: { fontSize: 14, color: colors.textMuted },
  successTotal: { fontSize: 28, fontWeight: "800", color: colors.navy },
  partialNotice: { fontSize: 13, color: colors.warning, textAlign: "center" },
});
