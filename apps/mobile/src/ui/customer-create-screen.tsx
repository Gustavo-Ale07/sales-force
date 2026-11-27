import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { applyCnpjAnswer } from "../data/customer-cnpj";
import { applyPostalCode, buildCreateRequest, commercialProblems, addressProblems, digitsOf, emptyCreateForm, hasProblems, identificationProblems, ADDRESS_LIMITS, type CreateForm, type CreateCustomerRequest, type IcmsClassificationOption, type SellerChoice } from "../data/customer-form";
import type { AddressPort } from "../offline/address-port";
import { CustomerRejectedError } from "../offline/pending-customers";
import { colors } from "../theme";
import { CityPicker, SuggestField } from "./address-fields";
import { Banner, CheckRow, FormField, formStyles } from "./customer-form-parts";
import { WizardFooter, WizardProgress } from "./order-wizard-parts";
import { PriceTablePicker, type PriceTableChoice } from "./price-table-picker";
import { SellerPicker } from "./seller-picker";

export interface CustomerCreateScreenProps {
  /**
   * "Cadastrar": online the server creates the customer in the ERP at once; offline (or a timeout) it is saved here and sent by itself.
   * A refusal throws `CustomerRejectedError` with the server's text per field; any other failure throws a seller-facing message.
   */
  readonly onSave: (request: CreateCustomerRequest) => Promise<void>;
  readonly onClose: () => void;
  /** The ICMS classifications with their names, as the server lists them. Empty until available: the selector is hidden and `R` is sent. */
  readonly icmsOptions?: readonly IcmsClassificationOption[];
  /** Active sellers to choose from; present ONLY when the signed-in user is not a seller. `null`/absent = a seller (automatic, locked). */
  readonly sellers?: readonly SellerChoice[] | null;
  /** Cities, neighborhoods, streets and CEP lookup (offline-first). Absent = free fields only (the city then cannot be chosen). */
  readonly addresses?: AddressPort;
}

const STEP_LABELS = ["Identificação", "Endereço e contato", "Comercial"] as const;
const LAST_STEP = STEP_LABELS.length - 1;

/** The screen that owns each field a refusal can name. */
const FIELD_STEP: Readonly<Record<string, number>> = {
  document: 0, name: 0, tradeName: 0, stateRegistration: 0, icmsClassification: 0,
  postalCode: 1, cityCode: 1, neighborhood: 1, neighborhoodName: 1, neighborhoodCode: 1, street: 1, streetName: 1, streetCode: 1, number: 1, complement: 1, phone: 1, email: 1,
  sellerCode: 2, priceTableCode: 2,
};
/** Request field name -> the form field that shows it. */
const FIELD_ALIAS: Readonly<Record<string, string>> = { neighborhoodName: "neighborhood", neighborhoodCode: "neighborhood", streetName: "street", streetCode: "street" };

/** Local failures of the save, already in the seller's words (`PendingCustomerError`) or generic. */
function saveMessage(error: unknown): string {
  if (error instanceof Error && error.name === "PendingCustomerError") return error.message;
  return "Não foi possível salvar o cadastro neste aparelho. Tente de novo.";
}

const NO_ADDRESS_PORT: AddressPort = {
  searchCities: () => Promise.resolve([]),
  searchNeighborhoods: () => Promise.resolve([]),
  searchStreets: () => Promise.resolve([]),
  customerPriceTables: () => Promise.resolve({ items: [], defaultCode: null }),
  lookupPostalCode: () => Promise.resolve(null),
};

/** "Novo cliente" in three screens (Identificação, Endereço e contato, Comercial); the last button registers. */
export function CustomerCreateScreen({ onSave, onClose, icmsOptions = [], sellers = null, addresses = NO_ADDRESS_PORT }: CustomerCreateScreenProps) {
  // `sellers` is given only for a user who is not a seller (manager and equivalent): the field is then required. A seller's customer is linked automatically.
  const sellerRequired = sellers !== null;
  const [form, setForm] = useState<CreateForm>(() => emptyCreateForm());
  const [step, setStep] = useState(0);
  const [serverFields, setServerFields] = useState<Readonly<Record<string, string>>>({});
  const [shownSteps, setShownSteps] = useState<readonly boolean[]>([false, false, false]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false);
  const lastCep = useRef("");
  const lastCnpj = useRef("");
  const [priceTables, setPriceTables] = useState<readonly PriceTableChoice[]>([]);

  // The tables come from the local copy of the last sync (works offline); the field starts as the installation default.
  useEffect(() => {
    let current = true;
    void addresses.customerPriceTables().then((answer) => {
      if (!current) return;
      setPriceTables(answer.items);
      setForm((now) => (now.priceTableCode === null && answer.defaultCode !== null ? { ...now, priceTableCode: answer.defaultCode } : now));
    });
    return () => {
      current = false;
    };
  }, [addresses]);

  const goBack = useCallback(() => {
    if (step === 0) onClose();
    else setStep(step - 1);
  }, [step, onClose]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [goBack]);

  const change = (next: Partial<CreateForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setServerFields((current) => {
      if (Object.keys(current).length === 0) return current;
      const touched = new Set(Object.keys(next).map((key) => (key === "cityLabel" ? "cityCode" : key)));
      return Object.fromEntries(Object.entries(current).filter(([key]) => !touched.has(key)));
    });
  };

  // A complete CEP fills the address from the server (or from the local memory when it cannot be reached). Never an error on screen.
  useEffect(() => {
    const cep = digitsOf(form.postalCode);
    if (cep.length !== 8 || cep === lastCep.current) return;
    lastCep.current = cep;
    let current = true;
    void addresses.lookupPostalCode(cep).then((answer) => {
      if (!current || answer === null) return;
      setForm((now) => (digitsOf(now.postalCode) === cep ? applyPostalCode(now, answer) : now));
    });
    return () => {
      current = false;
    };
  }, [form.postalCode, addresses]);

  // A complete CNPJ fills the company data from the server (nothing happens offline or on failure; the form stays free).
  useEffect(() => {
    const cnpj = digitsOf(form.document);
    if (form.personKind !== "company" || cnpj.length !== 14 || cnpj === lastCnpj.current || addresses.lookupCnpj === undefined) return;
    lastCnpj.current = cnpj;
    let current = true;
    void addresses.lookupCnpj(cnpj).then((answer) => {
      if (!current || answer === null) return;
      setForm((now) => (digitsOf(now.document) === cnpj ? applyCnpjAnswer(now, answer) : now));
    });
    return () => {
      current = false;
    };
  }, [form.document, form.personKind, addresses]);

  const stepProblems = (index: number): Record<string, string | null> =>
    index === 0 ? identificationProblems(form) : index === 1 ? addressProblems(form) : commercialProblems(form, { sellerRequired });
  const problems = stepProblems(step);
  const showing = shownSteps[step] === true;
  const fieldError = (field: string) => serverFields[field] ?? (showing ? (problems[field] ?? null) : null);

  const next = () => {
    setFailure(null);
    if (hasProblems(problems)) {
      setShownSteps((current) => current.map((value, index) => value || index === step));
      return;
    }
    setStep(step + 1);
  };

  const submit = async () => {
    if (busy.current) return;
    setFailure(null);
    setServerFields({});
    // The first screen with a local problem is shown, so the text appears on its field.
    for (let index = 0; index <= LAST_STEP; index += 1) {
      if (hasProblems(stepProblems(index))) {
        setShownSteps((current) => current.map((value, i) => value || i === index));
        setStep(index);
        return;
      }
    }
    busy.current = true;
    setSaving(true);
    try {
      await onSave(buildCreateRequest(form, { sellerRequired }));
    } catch (error) {
      if (error instanceof CustomerRejectedError) {
        const { _: general, ...raw } = error.fields;
        const fields: Record<string, string> = {};
        for (const [key, text] of Object.entries(raw)) fields[FIELD_ALIAS[key] ?? key] = text;
        setServerFields(fields);
        const known = Object.keys(raw).filter((key) => key in FIELD_STEP);
        const first = Math.min(...known.map((key) => FIELD_STEP[key] ?? LAST_STEP), LAST_STEP);
        if (known.length > 0) setStep(first);
        setFailure(general ?? (known.length < Object.keys(raw).length ? Object.values(raw).join(" ") : null));
      } else {
        setFailure(saveMessage(error));
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const company = form.personKind === "company";
  const searchCities = useCallback(
    async (query: string) => (await addresses.searchCities(query)).map((city) => ({ code: city.code, label: `${city.name} - ${city.uf}` })),
    [addresses],
  );
  const searchNeighborhoods = useCallback(async (query: string) => (await addresses.searchNeighborhoods(query)).map((item) => ({ code: item.code, label: item.name })), [addresses]);
  const searchStreets = useCallback(
    async (query: string) => (await addresses.searchStreets(query)).map((item) => ({ code: item.code, label: item.kind === null ? item.name : `${item.kind} ${item.name}` })),
    [addresses],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WizardProgress step="customer" custom={{ index: step + 1, total: STEP_LABELS.length, label: STEP_LABELS[step] ?? "" }} onExit={onClose} exitLabel="Sair do cadastro" />
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {failure !== null && <Banner text={failure} />}
        {step === 0 && (
          <>
            <View style={formStyles.chips}>
              {(["company", "individual"] as const).map((kind) => {
                const on = form.personKind === kind;
                return (
                  <Pressable key={kind} style={[formStyles.chip, on && formStyles.chipOn]} onPress={() => change({ personKind: kind, exempt: false, stateRegistration: "" })} accessibilityRole="radio" accessibilityLabel={kind === "company" ? "Pessoa Jurídica" : "Pessoa Física"} accessibilityState={{ selected: on }}>
                    <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{kind === "company" ? "Pessoa Jurídica" : "Pessoa Física"}</Text>
                  </Pressable>
                );
              })}
            </View>
            <FormField label={company ? "CNPJ" : "CPF"} required value={form.document} onChangeText={(document) => change({ document })} error={fieldError("document")} keyboardType="number-pad" />
            <FormField label={company ? "Razão social" : "Nome"} required value={form.name} onChangeText={(name) => change({ name })} error={fieldError("name")} />
            {company && (
              <>
                <FormField label="Nome fantasia" value={form.tradeName} onChangeText={(tradeName) => change({ tradeName })} error={fieldError("tradeName")} />
                <FormField label="Inscrição estadual" required={!form.exempt} value={form.exempt ? "" : form.stateRegistration} onChangeText={(stateRegistration) => change({ stateRegistration })} error={fieldError("stateRegistration")} editable={!form.exempt} />
                <CheckRow label="Isento" checked={form.exempt} onChange={(exempt) => change({ exempt, ...(exempt ? { stateRegistration: "" } : {}) })} />
              </>
            )}
            {icmsOptions.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>Classificação ICMS</Text>
                <View style={formStyles.chips}>
                  {icmsOptions.map((option) => {
                    const on = form.icmsClassification === option.code;
                    return (
                      <Pressable key={option.code} style={[formStyles.chip, on && formStyles.chipOn]} onPress={() => change({ icmsClassification: option.code })} accessibilityRole="radio" accessibilityLabel={`Classificação ${option.label}`} accessibilityState={{ selected: on }}>
                        <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <FormField label="CEP" value={form.postalCode} onChangeText={(postalCode) => change({ postalCode })} error={fieldError("postalCode")} keyboardType="number-pad" maxLength={9} />
            <CityPicker selectedCode={form.cityCode} selectedLabel={form.cityLabel} search={searchCities} onSelect={(city) => change({ cityCode: city.code, cityLabel: city.label })} error={fieldError("cityCode")} />
            <SuggestField label="Bairro" value={form.neighborhood} search={searchNeighborhoods} onChangeText={(neighborhood) => change({ neighborhood, neighborhoodCode: null })} onPick={(item) => change({ neighborhood: item.label.slice(0, ADDRESS_LIMITS.addressName), neighborhoodCode: item.code })} error={fieldError("neighborhood")} />
            <SuggestField label="Rua" value={form.street} search={searchStreets} onChangeText={(street) => change({ street, streetCode: null })} onPick={(item) => change({ street: item.label.slice(0, ADDRESS_LIMITS.addressName), streetCode: item.code })} error={fieldError("street")} />
            <FormField label="Número" value={form.number} onChangeText={(number) => change({ number })} error={fieldError("number")} maxLength={ADDRESS_LIMITS.number} />
            <FormField label="Complemento" value={form.complement} onChangeText={(complement) => change({ complement })} error={fieldError("complement")} maxLength={ADDRESS_LIMITS.complement} />
            <FormField label="Telefone" value={form.phone} onChangeText={(phone) => change({ phone })} error={fieldError("phone")} keyboardType="phone-pad" />
            <FormField label="E-mail" value={form.email} onChangeText={(email) => change({ email })} error={fieldError("email")} keyboardType="email-address" autoCapitalize="none" />
          </>
        )}
        {step === 2 && (
          <>
            <PriceTablePicker tables={priceTables} selectedCode={form.priceTableCode} onSelect={(priceTableCode) => change({ priceTableCode })} error={fieldError("priceTableCode")} />
            {sellerRequired ? (
              <SellerPicker sellers={sellers} selectedCode={form.sellerCode} onSelect={(sellerCode) => change({ sellerCode })} error={fieldError("sellerCode")} />
            ) : (
              <FormField label="Vendedor" value="Você" onChangeText={() => undefined} editable={false} error={serverFields.sellerCode ?? null} />
            )}
          </>
        )}
      </ScrollView>
      <WizardFooter
        onBack={goBack}
        onNext={step === LAST_STEP ? () => void submit() : next}
        nextLabel={step === LAST_STEP ? (saving ? "Cadastrando..." : "Cadastrar") : "Continuar"}
        nextDisabled={saving}
        busy={saving}
      />
    </View>
  );
}
