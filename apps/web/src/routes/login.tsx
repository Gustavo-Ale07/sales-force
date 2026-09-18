import { Alert, Button, Card, FormField, IconButton, Input } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { DevAuthBanner } from "../components/dev-auth-banner";
import { useAppServices } from "../lib/app-context";
import { sessionQueryKey, type LoginResult } from "../lib/auth-client";
import { safeRedirect } from "../lib/safe-redirect";

type LoginFailure = Extract<LoginResult, { ok: false }>;

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (email.trim().length === 0) errors.email = "Informe o e-mail.";
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Informe um e-mail válido, como nome@empresa.com.br.";
  if (password.length === 0) errors.password = "Informe a senha.";
  return errors;
}

function minutesText(seconds?: number): string {
  if (!seconds || seconds <= 0) return "alguns minutos";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

function FailureAlert({ failure }: { failure: LoginFailure }) {
  switch (failure.reason) {
    case "invalid_credentials":
      return <Alert tone="danger" title="E-mail ou senha incorretos." />;
    case "locked":
      return (
        <Alert tone="danger" title="Acesso temporariamente bloqueado.">
          Muitas tentativas sem sucesso. Tente novamente em {minutesText(failure.retryAfterSeconds)} ou fale com o administrador.
        </Alert>
      );
    case "rate_limited":
      return (
        <Alert tone="warning" title="Muitas tentativas em pouco tempo.">
          Aguarde alguns instantes e tente novamente.
        </Alert>
      );
    case "channel_forbidden":
      return (
        <Alert tone="warning" title="Este perfil acessa somente pelo aplicativo móvel.">
          Instale o aplicativo no aparelho aprovado.
        </Alert>
      );
    case "unavailable":
      return (
        <Alert tone="danger" title="Não foi possível entrar agora.">
          O serviço de autenticação está indisponível. Tente novamente em instantes.
          {failure.correlationId ? (
            <>
              {" "}
              Código de correlação: <span className="font-mono">{failure.correlationId}</span>
            </>
          ) : null}
        </Alert>
      );
  }
}

export function LoginPage() {
  const { authClient, config } = useAppServices();
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearch({ strict: false }) as { redirect?: unknown };

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const login = useMutation({
    mutationFn: () => authClient.login({ email: email.trim(), password }),
    onSuccess: (result) => {
      if (result.ok) {
        setFailure(null);
        queryClient.setQueryData(sessionQueryKey, result.user);
        router.history.push(safeRedirect(search.redirect) ?? "/");
        return;
      }
      setFailure(result);
      setPassword("");
      // Keep the keyboard user in the form: retry from the most likely wrong field.
      (result.reason === "invalid_credentials" ? passwordRef : emailRef).current?.focus();
    },
    onError: () => {
      setFailure({ ok: false, reason: "unavailable" });
    },
  });

  const locked = failure?.reason === "locked";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (login.isPending) return;
    const fieldErrors = validateLogin(email, password);
    setErrors(fieldErrors);
    if (fieldErrors.email) return emailRef.current?.focus();
    if (fieldErrors.password) return passwordRef.current?.focus();
    setFailure(null);
    login.mutate();
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <DevAuthBanner />
      <main id="conteudo" className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">
          <Card className="shadow-card">
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 p-6" aria-describedby="login-help">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-[26px] place-items-center rounded-md bg-accent text-[11px] font-extrabold tracking-wide text-on-accent"
                >
                  SF
                </span>
                <span className="text-base font-bold">{config.installationName}</span>
              </div>
              <div>
                <h1 className="m-0 text-xl font-semibold tracking-tight">Entrar</h1>
                <p className="m-0 mt-0.5 text-xs text-fg-muted">Use seu e-mail corporativo e sua senha.</p>
              </div>

              {failure ? <FailureAlert failure={failure} /> : null}

              <FormField label="E-mail" required error={errors.email}>
                <Input
                  ref={emailRef}
                  type="email"
                  name="email"
                  size="lg"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  placeholder="nome@empresa.com.br"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
                    if (locked) setFailure(null);
                  }}
                />
              </FormField>

              <FormField label="Senha" required error={errors.password}>
                <Input
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  name="password"
                  size="lg"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
                  }}
                  endSlot={
                    <IconButton
                      label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      size="sm"
                      icon={showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                      onClick={() => setShowPassword((current) => !current)}
                    />
                  }
                />
              </FormField>

              <Button type="submit" variant="primary" size="lg" block loading={login.isPending} loadingText="Entrando…" disabled={locked}>
                Entrar
              </Button>

              <p id="login-help" className="m-0 text-xs text-fg-muted">
                Acesso restrito a usuários internos autorizados. A sessão expira após inatividade.
              </p>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
