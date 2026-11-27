import { Button, FormField, Input } from "@salesforce/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../components/brand";
import { checkServerCode } from "../lib/api-server-code";
import { useAppServices } from "../lib/app-context";
import { documentTitleBase } from "../lib/brand";
import { serverKeyOf, storeServerCode } from "../lib/server-code";

/**
 * "Adicionar servidor": the only screen of a browser without a valid server code. The code is checked against the
 * guarded `/server-code/check` route; only after a 204 is it stored and the sign-in screen shown. The one message is
 * "Código inválido".
 */
export function AddServerPage() {
  const { config } = useAppServices();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = documentTitleBase(config.installationName);
  }, [config.installationName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (value === "" || serverKeyOf(value) === null) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    const accepted = await checkServerCode(value);
    setBusy(false);
    if (!accepted) {
      setInvalid(true);
      return;
    }
    // Nothing cached before the code can be trusted (an earlier session belonged to another server).
    queryClient.clear();
    storeServerCode(value);
  };

  return (
    <main id="conteudo" className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <form noValidate onSubmit={(event) => void submit(event)} className="flex w-full max-w-md flex-col gap-5 rounded-xl bg-surface p-6 shadow-pop sm:p-8">
        <div className="flex justify-center">
          <Brand size="lg" showProductName={false} />
        </div>
        <h1 className="m-0 text-center text-xl font-bold text-fg">Adicionar servidor</h1>
        <FormField label="Código do servidor" error={invalid ? "Código inválido" : undefined}>
          <Input
            size="md"
            name="server-code"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              if (invalid) setInvalid(false);
            }}
          />
        </FormField>
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.trim() === ""}>
          Adicionar
        </Button>
      </form>
    </main>
  );
}
