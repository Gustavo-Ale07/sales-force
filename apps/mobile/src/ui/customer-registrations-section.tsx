import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CustomerRegistration, CustomerWritePort } from "../data/customer-write";
import { colors, radius, spacing } from "../theme";

const ORDER: Record<CustomerRegistration["state"], number> = { needs_correction: 0, awaiting_send: 1, draft: 2, sent: 3 };
const VISIBLE = 5;

export interface CustomerRegistrationsSectionProps {
  readonly writer: Pick<CustomerWritePort, "registrations">;
  /** "Precisa de correção": opens the registration form filled in, sending `correctsRegistrationId`. */
  readonly onCorrect: (registration: CustomerRegistration) => void;
  /** Bumped by the caller after a registration is saved, to read the list again. */
  readonly refreshKey?: number;
}

function maskDocument(digits: string): string {
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  return "*".repeat(Math.max(digits.length, 1));
}

/** The seller's registrations made through the Force with the server's state text (same labels as the site, PAR-1). Online only. */
export function CustomerRegistrationsSection({ writer, onCorrect, refreshKey = 0 }: CustomerRegistrationsSectionProps) {
  const [items, setItems] = useState<readonly CustomerRegistration[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    writer
      .registrations()
      .then((found) => {
        if (!current) return;
        setFailed(false);
        setItems([...found].sort((x, y) => ORDER[x.state] - ORDER[y.state]));
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [writer, refreshKey, attempt]);

  const retry = () => {
    setFailed(false);
    setItems(null);
    setAttempt((value) => value + 1);
  };

  const shown = items === null ? [] : all ? items : items.slice(0, VISIBLE);
  return (
    <View style={styles.box} accessibilityLabel="Cadastros de clientes">
      <Text style={styles.title} accessibilityRole="header">Cadastros de clientes</Text>
      {failed ? (
        <View style={styles.row}>
          <Text style={styles.meta}>Não foi possível carregar os cadastros.</Text>
          <Pressable style={styles.link} onPress={retry} accessibilityRole="button" accessibilityLabel="Tentar de novo">
            <Text style={styles.linkText}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : items === null ? (
        <Text style={styles.meta}>Carregando cadastros...</Text>
      ) : items.length === 0 ? (
        <Text style={styles.meta}>Nenhum cadastro feito pelo Force</Text>
      ) : (
        <>
          {shown.map((item) => (
            <View key={item.registrationId} style={styles.item}>
              <View style={styles.row}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                <Text style={[styles.state, item.state === "needs_correction" && styles.stateDanger]}>{item.stateLabel}</Text>
              </View>
              <Text style={styles.meta}>{`${maskDocument(item.document)}${item.customerCode === null ? "" : ` · Cliente ${item.customerCode}`}`}</Text>
              {item.state === "needs_correction" && item.reasonMessage !== null && <Text style={styles.reason}>{item.reasonMessage}</Text>}
              {item.state === "needs_correction" && (
                <Pressable style={styles.link} onPress={() => onCorrect(item)} accessibilityRole="button" accessibilityLabel={`Corrigir cadastro de ${item.name}`}>
                  <Text style={styles.linkText}>Corrigir cadastro</Text>
                </Pressable>
              )}
            </View>
          ))}
          {items.length > VISIBLE && (
            <Pressable style={styles.link} onPress={() => setAll((value) => !value)} accessibilityRole="button" accessibilityLabel={all ? "Ver menos cadastros" : "Ver todos os cadastros"}>
              <Text style={styles.linkText}>{all ? "Ver menos" : `Ver todos (${items.length})`}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  item: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  name: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  state: { fontSize: 12, fontWeight: "700", color: colors.warning },
  stateDanger: { color: colors.red },
  reason: { fontSize: 13, color: colors.red },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { color: colors.navy, fontSize: 13, fontWeight: "700" },
});
