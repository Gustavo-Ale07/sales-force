import { Alert, Button, IconButton, Input } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, LockKeyhole, User } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Brand } from "../components/brand";
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
          Aguarde {failure.retryAfterSeconds ? minutesText(failure.retryAfterSeconds) : "alguns instantes"} e tente novamente.
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

/** Reference fields: 56px tall, soft grey fill, no border until hover/focus, 12px radius, room for the leading icon. */
const LOGIN_FIELD =
  "h-14 rounded-xl border-transparent bg-[#eef1f6] pl-14 text-base text-fg placeholder:text-fg-muted hover:border-line-strong focus-visible:bg-white";

export function LoginPage() {
  const { authClient } = useAppServices();
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
    <div className="flex min-h-screen flex-col bg-white">
      <DevAuthBanner />
      {/* Approved reference: campaign photograph on the left (~69%), white sign-in panel on the right. */}
      <main id="conteudo" className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,69fr)_minmax(420px,31fr)]">
        <LoginHero />

        <section className="relative isolate flex flex-col overflow-hidden bg-white px-6 pb-8 pt-10 sm:px-10 lg:px-[clamp(32px,3.6vw,56px)] lg:pt-[clamp(48px,13vh,120px)]">
          <LoginCorner />
          <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col">
            <div className="flex flex-col items-center">
              <PanelLogo />
              <p className="m-0 mt-5 text-center text-[11px] font-semibold uppercase tracking-[0.42em] text-[#01136a] sm:text-xs">Plataforma comercial</p>
              <span aria-hidden="true" className="mt-3 h-[2px] w-9 rounded-full bg-cta" />
            </div>

            <form noValidate onSubmit={onSubmit} className="mt-[clamp(32px,10.4vh,104px)] flex animate-sf-fade-in flex-col gap-5" aria-describedby="login-help">
              <div>
                <h1 className="m-0 text-[26px] font-extrabold leading-8 tracking-tight text-[#0b1442]">Bem-vindo(a)!</h1>
                <p className="m-0 mt-2 text-[17px] text-fg-muted">Acesse sua conta para continuar.</p>
              </div>

              {failure ? <FailureAlert failure={failure} /> : null}

              <div className="mt-4 flex flex-col gap-1.5">
                <label htmlFor="login-email" className="sr-only">
                  Usuário (E-mail)
                </label>
                <Input
                  id="login-email"
                  ref={emailRef}
                  type="email"
                  name="email"
                  className={LOGIN_FIELD}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  placeholder="Usuário"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  startSlot={<User size={26} strokeWidth={1.4} className="ml-2 text-[#0b1442]" aria-hidden="true" />}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
                    if (locked) setFailure(null);
                  }}
                />
                {errors.email ? (
                  <p id="login-email-error" role="alert" className="m-0 text-xs text-danger">
                    {errors.email}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="sr-only">
                  Senha
                </label>
                <Input
                  id="login-password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  name="password"
                  className={LOGIN_FIELD}
                  autoComplete="current-password"
                  placeholder="Senha"
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                  startSlot={<LockKeyhole size={26} strokeWidth={1.4} className="ml-2 text-[#0b1442]" aria-hidden="true" />}
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
                      className="mr-2 text-[#0b1442]"
                      icon={
                        showPassword ? <Eye size={20} strokeWidth={1.5} aria-hidden="true" /> : <EyeOff size={20} strokeWidth={1.5} aria-hidden="true" />
                      }
                      onClick={() => setShowPassword((current) => !current)}
                    />
                  }
                />
                {errors.password ? (
                  <p id="login-password-error" role="alert" className="m-0 text-xs text-danger">
                    {errors.password}
                  </p>
                ) : null}
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={login.isPending}
                loadingText="Entrando…"
                disabled={locked}
                className="mt-1.5 h-14 rounded-[10px] text-lg font-bold shadow-[0_8px_18px_-8px_rgba(224,0,26,0.55)]"
              >
                Entrar
                <ArrowRight size={22} strokeWidth={2} aria-hidden="true" />
              </Button>

              <p id="login-help" className="sr-only">
                Acesso restrito a usuários internos autorizados. A sessão expira após inatividade.
              </p>
            </form>

            <LoginFooter />
          </div>
        </section>
      </main>
    </div>
  );
}

/** Left column: the campaign photograph of the approved reference (headline and tagline are part of the artwork). */
function LoginHero() {
  return (
    <section
      role="img"
      aria-label="PLAC, artigos para festas e confeitaria. Venda com agilidade: catálogo, pedidos e clientes em um só lugar."
      className="relative overflow-hidden bg-[#0b1442] max-lg:h-[min(112vw,560px)] lg:min-h-full"
    >
      <img
        src="/assets/login/login-hero.png"
        alt=""
        width={1153}
        height={941}
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover object-[left_center]"
      />
    </section>
  );
}

/** Soft organic shape in the top-right corner of the panel. */
function LoginCorner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 300"
      preserveAspectRatio="xMaxYMin slice"
      className="pointer-events-none absolute right-0 top-0 -z-10 h-[24%] w-[62%] text-[#f0f3f9]"
    >
      <path fill="currentColor" d="M110 0h290v250c-40-10-70-40-88-80-22-50-60-58-104-72C158 84 120 60 110 0Z" />
    </svg>
  );
}

/** The installation's logo, large and centred; falls back to the compact brand component. */
function PanelLogo() {
  const { config } = useAppServices();
  const { logoUrl } = config.brand;
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return <img src={logoUrl} alt={config.installationName} onError={() => setFailed(true)} className="h-auto w-[clamp(180px,15vw,232px)] object-contain" />;
  }
  return <Brand size="lg" showProductName={false} />;
}

/** Faint line-art (cupcake liner, gift box) with the closing tagline. */
function LoginFooter() {
  return (
    <div className="relative mt-10 flex min-h-[190px] flex-1 items-end justify-center pb-2">
      <svg
        aria-hidden="true"
        viewBox="0 0 440 190"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-full w-full text-[#d5dbe8]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g transform="translate(-6 30)">
          <path d="M20 110c-8-40 14-70 48-70s52 26 44 70c-10 24-70 30-92 0Z" />
          <path d="M34 100c-4-28 8-46 34-46s40 18 32 46M48 94c0-18 6-30 20-30s22 12 18 30" />
          <circle cx="68" cy="82" r="14" />
          <path d="M108 100c6-30 30-48 58-38 22 8 22 40 0 58-16 12-46 8-58-20Z" />
          <path d="M120 96c8-18 22-26 40-20M126 108c10-12 26-18 40-12" />
        </g>
        <g transform="translate(340 34)">
          <path d="M10 60h92v96H10zM4 44h104v18H4z" />
          <path d="M56 44v112M56 44c-14-22-40-24-38-8 2 14 28 12 38 8Zm0 0c14-22 40-24 38-8-2 14-28 12-38 8Z" />
        </g>
      </svg>
      <div className="relative flex flex-col items-center gap-2 text-center">
        <p className="m-0 text-[10px] font-medium uppercase leading-5 tracking-[0.34em] text-fg-muted">
          Artigos para festas
          <br />&amp; confeitaria
        </p>
        <span aria-hidden="true" className="h-[2px] w-8 rounded-full bg-cta" />
      </div>
    </div>
  );
}
