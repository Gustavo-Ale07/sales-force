import { Alert, Button, IconButton, Input } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff, LockKeyhole, User } from "lucide-react";
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
  "h-14 [@media(max-height:720px)]:h-12 rounded-[10px] border-transparent bg-[#eef2f6] pl-[67px] text-[17px] tracking-[-0.03em] text-fg placeholder:text-[#4d5a78] hover:border-line-strong focus-visible:bg-white";

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
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <DevAuthBanner />
      {/* Approved reference: campaign photograph on the left (~69%), white sign-in panel on the right. */}
      <main id="conteudo" className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,69fr)_minmax(420px,31fr)]">
        <LoginHero />

        <section className="relative isolate flex min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#fdfefd] px-6 sm:px-10 lg:px-0">
          <LoginCorner />
          {/* Vertical rhythm is flex-driven: these spacers, the field height and the footer shrink with the viewport height. */}
          <div aria-hidden="true" className="min-h-4 flex-[0_1_40px] lg:flex-[0_1_13.5vh]" />
          <div className="flex flex-col items-center">
            <PanelLogo />
            <p className="m-0 mt-3 text-center text-[17px] font-medium uppercase leading-5 tracking-[0.33em] text-[#1a2347]">Plataforma comercial</p>
            <span aria-hidden="true" className="mt-4 h-[3px] w-[47px] bg-cta" />
          </div>

          <div aria-hidden="true" className="min-h-3 flex-[0_1_40px] lg:flex-[0_1_5.8vh]" />
          <div className="mx-auto mb-4 flex w-full max-w-[560px] flex-col lg:pl-[11.75%] lg:pr-[8.7%]">
            <form noValidate onSubmit={onSubmit} className="flex animate-sf-fade-in flex-col gap-5 [@media(max-height:720px)]:gap-3" aria-describedby="login-help">
              <div>
                <h1 className="m-0 text-[26px] font-extrabold leading-8 tracking-[0.05em] text-[#0b1436]">Bem-vindo(a)!</h1>
                <p className="m-0 mt-1.5 text-[18px] leading-6 tracking-[0.032em] text-[#4b5675]">Acesse sua conta para continuar.</p>
              </div>

              {failure ? <FailureAlert failure={failure} /> : null}

              <div className="mt-[18px] flex flex-col gap-1.5">
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
                  startSlot={<User size={35} strokeWidth={1.2} className="-ml-1 text-[#0b1a3d]" aria-hidden="true" />}
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
                  startSlot={<LockKeyhole size={32} strokeWidth={1.3} className="-ml-0.5 text-[#0b1a3d]" aria-hidden="true" />}
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
                      className="mr-1 size-10 text-[#0b1a3d]"
                      icon={
                        showPassword ? <Eye size={28} strokeWidth={1.5} aria-hidden="true" /> : <EyeOff size={28} strokeWidth={1.5} aria-hidden="true" />
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
                className="mt-[5px] h-14 gap-[17px] [@media(max-height:720px)]:h-12 rounded-[10px] bg-[#de0219] text-[20px] font-bold hover:bg-[#c90116]"
              >
                Entrar
                <svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 8h18M13 1.5 19.5 8 13 14.5" /></svg>
              </Button>

              <p id="login-help" className="sr-only">
                Acesso restrito a usuários internos autorizados. A sessão expira após inatividade.
              </p>
            </form>
          </div>

          <LoginFooter />
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
      className="relative hidden overflow-hidden bg-[#0b1442] lg:block lg:min-h-full"
    >
      <img
        src="/assets/login/login-hero.png"
        alt=""
        width={1374}
        height={1145}
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover object-[left_center]"
      />
    </section>
  );
}

/** Soft organic shape in the top-right corner of the panel (measured on the reference: 518-unit-wide panel). */
function LoginCorner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 518 200" className="pointer-events-none absolute right-0 top-0 -z-10 h-auto w-full">
      <path fill="#f1f5fb" d="M340 0C380 20 400 50 425 75C455 105 490 130 518 175V0Z" />
    </svg>
  );
}

/** The installation's logo, centred in a 114px band (reference height); falls back to the compact brand component. */
function PanelLogo() {
  const { config } = useAppServices();
  const { logoUrl } = config.brand;
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex items-center justify-center lg:h-[114px] lg:[@media(max-height:720px)]:h-[84px]">
      {logoUrl && !failed ? (
        <img src={logoUrl} alt={config.installationName} onError={() => setFailed(true)} className="h-auto max-h-[114px] w-[clamp(180px,14vw,232px)] object-contain [@media(max-height:720px)]:max-h-[84px]" />
      ) : (
        <Brand size="lg" showProductName={false} />
      )}
    </div>
  );
}

/** Faint line-art (petal cup with truffle, wrapper, gift box) over a soft wave, with the closing tagline. */
function LoginFooter() {
  return (
    <div className="relative -mx-6 mt-auto min-h-[112px] flex-[0_1_261px] sm:-mx-10 lg:mx-0">
      <svg aria-hidden="true" viewBox="0 0 518 261" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="login-wave" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fbfcfd" />
            <stop offset="1" stopColor="#f4f7fc" />
          </linearGradient>
        </defs>
        <path d="M0 207C110 150 300 130 518 166V261H0Z" fill="url(#login-wave)" />
      </svg>
      <svg
        aria-hidden="true"
        viewBox="0 0 518 261"
        preserveAspectRatio="xMidYMax meet"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-full w-full"
        fill="none"
        stroke="#cfd5e3"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
                {/* Art traced in 2x coordinates of the reference: petal cup with truffle, folded wrapper, gift box with bow. */}
        <g transform="scale(0.5)" strokeWidth="2.2">
          <path d="M154 185C150 140 165 105 190 105C215 105 232 140 226 185" />
          <path d="M92 190C90 150 110 125 135 122C150 122 158 135 160 165" />
          <path d="M222 165C224 135 240 120 262 124C280 130 285 160 270 195" />
          <path d="M52 200C48 180 70 170 90 180C110 190 120 215 122 240" />
          <path d="M316 205C318 180 300 165 285 178C270 190 262 215 258 240" />
          <path d="M55 232C60 245 85 262 130 292L142 300M312 232C300 250 270 275 238 298" />
          <path d="M112 268L142 300L180 338H240L262 296M185 300L180 338M235 300L240 338" />
          <clipPath id="login-truffle">
            <ellipse cx="185" cy="240" rx="74" ry="58" />
          </clipPath>
          <ellipse cx="185" cy="240" rx="74" ry="58" />
          <path clipPath="url(#login-truffle)" strokeWidth="1.6" d="M112 187 L127 194 L142 188 L157 187 L172 192 L187 190 L202 188 L217 193 L232 193 L247 190 L262 192M112 208 L127 210 L142 204 L157 206 L172 209 L187 209 L202 203 L217 209 L232 207 L247 211 L262 210M112 222 L127 224 L142 228 L157 226 L172 225 L187 225 L202 228 L217 228 L232 223 L247 222 L262 227M112 240 L127 238 L142 239 L157 240 L172 239 L187 245 L202 242 L217 243 L232 245 L247 237 L262 239M112 258 L127 258 L142 257 L157 255 L172 262 L187 254 L202 257 L217 256 L232 260 L247 262 L262 258M112 273 L127 274 L142 273 L157 274 L172 274 L187 273 L202 275 L217 276 L232 272 L247 279 L262 275M112 294 L127 293 L142 293 L157 292 L172 292 L187 294 L202 296 L217 291 L232 294 L247 290 L262 293 M117 193 l-1 17 M121 230 l-3 17 M115 265 l-1 17 M115 293 l4 17 M138 192 l-3 17 M138 228 l-3 17 M140 265 l3 17 M140 299 l2 17 M152 192 l-2 17 M152 225 l1 17 M158 260 l-0 17 M154 298 l3 17 M174 192 l3 17 M175 225 l-4 17 M176 265 l3 17 M178 292 l-2 17 M195 198 l1 17 M192 226 l-2 17 M190 263 l2 17 M196 298 l-0 17 M210 190 l3 17 M215 225 l3 17 M216 258 l3 17 M217 300 l2 17 M230 193 l2 17 M231 231 l-2 17 M235 261 l0 17 M233 295 l2 17 M253 193 l-1 17 M249 226 l4 17 M252 266 l3 17 M249 299 l1 17" />
          <path d="M300 160L360 152C395 152 425 168 434 200L455 275L418 306L330 300L303 282ZM360 152L322 292M360 152L436 240M434 200L392 262L455 275M330 300L392 262M300 160L322 292" />
          <path d="M770 208L885 192L945 410L835 410ZM885 192L950 178L1036 196M948 180L1000 410M978 182L1036 395M945 410H1000" />
          <path d="M795 132L830 110L880 120L918 130L890 160L830 190L800 160ZM918 130L950 90L985 40L1010 38L1036 60M918 130L980 118L1036 110M918 145L935 200L900 185" />
          <circle cx="918" cy="130" r="14" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-[34px] flex flex-col items-center">
        <p className="m-0 text-center text-[12px] font-medium uppercase leading-[18px] tracking-[0.46em] text-[#2d3860]">
          Artigos para festas
          <br />&amp; confeitaria
        </p>
        <span aria-hidden="true" className="ml-1 mt-[10px] h-[3px] w-11 bg-cta" />
      </div>
    </div>
  );
}
