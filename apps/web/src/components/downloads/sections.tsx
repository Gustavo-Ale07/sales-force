import { cn } from "@salesforce/ui";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Download, LogIn, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import loginHeroUrl from "../../assets/login/login-hero.png";
import { formatSize, type DownloadItem } from "../../lib/downloads";
import { AndroidIcon, CurveArt, DesktopIcon, OfflineIcon, OrderIcon, PhoneIcon, PhoneMock, PhotoIcon, Section, UpdateIcon } from "./art";
import { CtaSkeleton, PILL_GHOST, PILL_OFF, PILL_OUTLINE, PILL_SOLID, PILL_WHITE, type PublishedState } from "./cta";
import { Reveal, useInView } from "./use-in-view";

const H2_LIGHT = "m-0 text-[clamp(30px,4.6vw,52px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-[var(--sf-navy)] text-balance";
const H2_DARK = "m-0 text-[clamp(30px,4.6vw,52px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-white text-balance";
const CARD = "rounded-[32px] border border-[var(--sf-border)] bg-white shadow-[var(--dl-card-shadow)]";

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={cn("m-0 mb-4 text-[13px] font-extrabold uppercase tracking-[0.24em]", dark ? "text-[var(--dl-red-soft-2)]" : "text-[var(--sf-cta)]")}>{children}</p>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

const NAV = [
  { href: "#baixar", label: "Baixar", current: true },
  { href: "#beneficios", label: "Benefícios", current: false },
  { href: "#instalar", label: "Como instalar", current: false },
  { href: "#ajuda", label: "Ajuda", current: false },
] as const;

function TopBar() {
  return (
    <header className="relative z-20 mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:py-7">
      <Link to="/downloads" className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70" aria-label="Force, página de downloads">
        <img src="/brand/plac-logo.png" alt="PLAC" height={44} className="h-11 w-auto rounded-[9px] bg-white" />
        <span className="text-[22px] font-extrabold tracking-tight text-white">Force</span>
      </Link>
      <nav aria-label="Seções da página" className="hidden items-center gap-1 rounded-full border border-white/15 bg-white/10 p-1.5 backdrop-blur md:flex">
        {NAV.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.current ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold text-white lg:px-5 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              link.current && "bg-white/20",
            )}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <Link to="/login" className={cn(PILL_WHITE, "min-h-11 px-6 text-sm")}>
        Entrar
      </Link>
    </header>
  );
}

function BrandSeal({ tone = "light" }: { tone?: "light" }) {
  void tone;
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden="true" className="h-0.5 w-14 bg-[var(--sf-cta)]" />
      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/75">PLAC | Artigos para festas &amp; confeitaria</span>
    </div>
  );
}

function StatusLabel({ state }: { state: PublishedState }) {
  const ready = state.kind === "ready";
  const text = ready ? "Aplicativo Android disponível" : state.kind === "loading" ? "Verificando a versão" : state.kind === "none" ? "Em breve" : "Aplicativo Android";
  return (
    <span className="inline-flex w-fit items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em] text-white">
      <span aria-hidden="true" className={cn("size-2 rounded-full", ready ? "bg-[#3ddc84]" : "bg-white/50")} />
      {text}
    </span>
  );
}

function DownloadLink({ item, className, label = "Baixar para Android" }: { item: DownloadItem; className?: string; label?: string }) {
  return (
    <a href={item.url} download className={cn(PILL_SOLID, className)}>
      <AndroidIcon className="size-5" />
      {label}
    </a>
  );
}

const SEALS = [
  { icon: <ShieldCheck aria-hidden="true" className="size-5" />, label: "Arquivo verificado" },
  { icon: <UpdateIcon className="size-5" />, label: "Atualiza sozinho" },
  { icon: <OfflineIcon className="size-5" />, label: "Funciona offline" },
] as const;

export function Hero({ state, onRetry, retrying }: { state: PublishedState; onRetry: () => void; retrying: boolean }) {
  const [heroRef, heroVisible] = useInView<HTMLElement>({ threshold: 0.12 });
  const item = state.kind === "ready" ? state.item : null;
  return (
    <>
      <section id="baixar" ref={heroRef} aria-labelledby="dl-hero-title" className="dl-hero-bg relative overflow-hidden text-white">
        <TopBar />
        <div className="relative z-10 mx-auto grid max-w-[1320px] items-center gap-10 px-5 pb-28 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-6 lg:pb-40 lg:pt-8">
          <div className="flex flex-col items-start gap-7">
            <BrandSeal />
            <StatusLabel state={state} />
            <h1 id="dl-hero-title" className="m-0 text-[46px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[64px] lg:text-[76px]">
              <span className="block">Baixe o Force</span> <span className="block text-[var(--dl-red-soft)]">onde você estiver.</span>
            </h1>
            <p className="m-0 max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl">
              Catálogo, pedidos e clientes da PLAC no seu bolso. Funciona mesmo sem internet e se atualiza sozinho.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {item ? <DownloadLink item={item} className="min-h-14 px-8 text-lg" /> : null}
              {state.kind === "loading" ? <CtaSkeleton /> : null}
              <a href="#instalar" className={cn(PILL_GHOST, "min-h-14 px-8")}>
                Como instalar
              </a>
            </div>
            {item ? (
              <p className="m-0 text-sm text-white/80">
                Versão {item.versionName} · {formatSize(item.sizeBytes)} · Android
              </p>
            ) : null}
            {state.kind === "none" ? <p className="m-0 text-base text-white/85">O aplicativo ainda não foi publicado.</p> : null}
            {state.kind === "error" ? (
              <p role="alert" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-[var(--sf-cta-weak)] px-4 py-3 text-sm font-semibold text-[var(--dl-red-deep)]">
                Não foi possível carregar a lista de downloads.
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="min-h-11 rounded-full px-2 font-extrabold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-red-deep)] disabled:opacity-70"
                >
                  {retrying ? "Tentando…" : "Tentar de novo"}
                </button>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center rounded-full border border-white/25 px-4 text-xs font-extrabold uppercase tracking-wider text-white/80">
                iPhone — EM BREVE
              </button>
              <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center rounded-full border border-white/25 px-4 text-xs font-extrabold uppercase tracking-wider text-white/80">
                Google Play — EM BREVE
              </button>
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm font-semibold text-white/85">
              {SEALS.map((seal) => (
                <li key={seal.label} className="inline-flex items-center gap-2 text-[var(--dl-red-soft-2)]">
                  {seal.icon}
                  <span className="text-white/85">{seal.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-[342px] lg:ml-auto lg:mr-0 lg:max-w-[456px]">
            <div className="relative h-[330px] overflow-hidden rounded-[32px] border border-white/20 lg:h-[629px] lg:rounded-[44px]">
              <img src={loginHeroUrl} alt="Equipe e produtos da PLAC" className="size-full origin-[100%_60%] scale-[1.9] object-cover object-[100%_center] lg:scale-[1.2] xl:scale-100" />
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[var(--sf-navy)]/85 to-transparent" />
            </div>
            <PhoneMock className="dl-float absolute -bottom-6 -right-3 w-[170px] lg:-left-8 lg:bottom-10 lg:right-auto lg:w-[230px] xl:-left-20 xl:w-[280px] [--dl-rot:-5deg]" style={{ rotate: "-5deg" }} />
          </div>
        </div>
        <CurveArt className="bottom-0 h-28 lg:h-40" />
      </section>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex h-[72px] items-center justify-between gap-3 bg-white/95 px-4 shadow-[0_-10px_30px_rgb(1_19_106/0.16)] backdrop-blur transition duration-300 md:hidden",
          heroVisible && item ? "translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-full opacity-0",
        )}
      >
        {item ? (
          <>
            <div className="min-w-0 leading-tight">
              <p className="m-0 truncate text-sm font-extrabold text-[var(--sf-navy)]">Force {item.versionName}</p>
              <p className="m-0 truncate text-xs text-[var(--sf-fg-muted)]">Android · {formatSize(item.sizeBytes)}</p>
            </div>
            <a href={item.url} download tabIndex={-1} className={cn(PILL_SOLID, "min-h-11 px-6 text-sm")}>
              Baixar
            </a>
          </>
        ) : null}
      </div>
    </>
  );
}

function PlatformCard({ icon, name, badge, soon = false, text, action }: { icon: ReactNode; name: string; badge: string; soon?: boolean; text: string; action: ReactNode }) {
  return (
    <div className={cn(CARD, "flex h-full flex-col gap-5 p-8")}>
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-[var(--sf-cta-weak)] text-[var(--sf-cta)]">{icon}</span>
        <span
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs font-extrabold",
            soon ? "bg-[var(--dl-soon-bg)] text-[var(--dl-soon-fg)]" : "bg-[var(--dl-ok-bg)] text-[var(--dl-ok-fg)]",
          )}
        >
          {badge}
        </span>
      </div>
      <h3 className="m-0 text-2xl font-extrabold tracking-tight text-[var(--sf-navy)]">{name}</h3>
      <p className="m-0 flex-1 text-base leading-relaxed text-[var(--sf-fg-muted)]">{text}</p>
      <div>{action}</div>
    </div>
  );
}

export function Platforms({ state }: { state: PublishedState }) {
  const item = state.kind === "ready" ? state.item : null;
  return (
    <Section id="plataformas" labelledBy="dl-plat-title" className="bg-[var(--sf-bg)]">
      <div className="mx-auto max-w-[1320px]">
        <Reveal>
          <Eyebrow>Escolha como usar</Eyebrow>
          <h2 id="dl-plat-title" className={H2_LIGHT}>
            Um Force, todos os caminhos.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Reveal className="h-full">
            <PlatformCard
              icon={<AndroidIcon className="size-7" />}
              name="Android"
              badge={item ? "Disponível" : "Em breve"}
              soon={!item}
              text="Instale o aplicativo no celular ou tablet. O download é um arquivo direto, sem loja."
              action={
                item ? (
                  <a href={item.url} download className={cn(PILL_SOLID, "w-full sm:w-auto")}>
                    Baixar APK
                  </a>
                ) : state.kind === "loading" ? (
                  <CtaSkeleton className="h-12 w-40 bg-[var(--sf-surface-3)]" />
                ) : (
                  <button type="button" disabled className={PILL_OFF}>
                    Em breve
                  </button>
                )
              }
            />
          </Reveal>
          <Reveal delay={90} className="h-full">
            <PlatformCard
              icon={<PhoneIcon className="size-7" />}
              name="iPhone"
              badge="Em breve"
              soon
              text="Estamos preparando a versão para iPhone e iPad."
              action={
                <button type="button" disabled className={PILL_OFF}>
                  Em breve
                </button>
              }
            />
          </Reveal>
          <Reveal delay={180} className="h-full">
            <PlatformCard
              icon={<DesktopIcon className="size-7" />}
              name="Computador"
              badge="Disponível"
              text="Abra o Force no navegador, sem instalar nada."
              action={
                <Link to="/" className={PILL_OUTLINE}>
                  Abrir o Force
                </Link>
              }
            />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

const BENEFITS = [
  { icon: OfflineIcon, title: "Funciona offline", text: "Registre pedidos sem sinal. Tudo segue quando a conexão voltar." },
  { icon: PhotoIcon, title: "Catálogo com fotos", text: "Mostre o produto ao cliente, com preço da tabela dele, antes de fechar a venda." },
  { icon: OrderIcon, title: "Pedido direto para o Sankhya", text: "Sem redigitar. Acompanhe liberação, faturamento e nota de cada pedido." },
  { icon: UpdateIcon, title: "Atualiza sozinho", text: "As novas versões chegam ao app sem você precisar baixar de novo." },
] as const;

export function Benefits() {
  return (
    <Section id="beneficios" labelledBy="dl-ben-title" className="dl-hero-bg py-24 text-white md:py-32">
      <CurveArt className="top-0 h-24 rotate-180 lg:h-32" />
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <Reveal>
            <Eyebrow dark>Feito para a venda</Eyebrow>
            <h2 id="dl-ben-title" className={H2_DARK}>
              Catálogo, pedido e cliente em um só lugar.
            </h2>
          </Reveal>
          <ul className="m-0 mt-12 grid list-none gap-8 p-0 sm:grid-cols-2">
            {BENEFITS.map((benefit, index) => (
              <li key={benefit.title}>
                <Reveal delay={index * 80} className="flex flex-col gap-4">
                  <span className="grid size-14 place-items-center rounded-[18px] bg-[linear-gradient(135deg,var(--dl-red-bright),var(--dl-red-deep))] text-white">
                    <benefit.icon className="size-7" />
                  </span>
                  <h3 className="m-0 text-xl font-extrabold tracking-tight">{benefit.title}</h3>
                  <p className="m-0 text-base leading-relaxed text-white/80">{benefit.text}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative mx-auto hidden h-[640px] w-full max-w-[560px] lg:block" aria-hidden="true">
          <PhoneMock screen="catalog" className="dl-float absolute left-0 top-10 w-[270px] [--dl-rot:-4deg]" style={{ rotate: "-4deg" }} />
          <PhoneMock screen="order" className="dl-float-slow absolute bottom-0 right-0 w-[270px] [--dl-rot:4deg]" style={{ rotate: "4deg" }} />
        </div>
      </div>
    </Section>
  );
}

const STEPS = [
  { icon: Download, title: "Baixe o arquivo", text: "Abra esta página no celular e toque em Baixar para Android." },
  { icon: ShieldCheck, title: "Permita a instalação", text: "Ao abrir o arquivo, permita a instalação de apps desta origem quando o Android pedir." },
  { icon: LogIn, title: "Entre e venda", text: "Abra o Force e entre com o seu usuário. O app se atualiza sozinho." },
] as const;

export function HowTo() {
  return (
    <Section id="instalar" labelledBy="dl-how-title" className="bg-white">
      <div className="mx-auto max-w-[1320px]">
        <Reveal>
          <Eyebrow>Passo a passo</Eyebrow>
          <h2 id="dl-how-title" className={H2_LIGHT}>
            Instale em 3 passos.
          </h2>
        </Reveal>
        <ol className="m-0 mt-12 grid list-none gap-6 p-0 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delay={index * 90} className="h-full">
                <div className="flex h-full flex-col gap-5 rounded-[32px] bg-[var(--sf-bg)] p-8">
                  <div className="flex items-center justify-between">
                    <span aria-hidden="true" className="grid size-[60px] place-items-center rounded-full bg-[var(--sf-cta)] text-2xl font-extrabold text-white">
                      {index + 1}
                    </span>
                    <step.icon aria-hidden="true" className="size-8 text-[var(--sf-accent-text)]" strokeWidth={2} />
                  </div>
                  <h3 className="m-0 text-xl font-extrabold tracking-tight text-[var(--sf-navy)]">{step.title}</h3>
                  <p className="m-0 text-base leading-relaxed text-[var(--sf-fg-muted)]">{step.text}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
        <p className="m-0 mt-8 rounded-2xl bg-[var(--sf-cta-weak)] px-5 py-4 text-sm font-semibold leading-relaxed text-[var(--dl-red-deep)] md:hidden">
          Se o Android avisar que o arquivo vem de fora da loja, é esperado: permita a instalação desta origem para continuar.
        </p>
      </div>
    </Section>
  );
}

const FAQ = [
  {
    q: "O Android bloqueou a instalação?",
    a: "Na primeira vez, o Android pede permissão para instalar apps de fora da loja. Toque em Configurações, permita a instalação a partir do navegador ou do gerenciador de arquivos que você usou e volte para concluir.",
  },
  {
    q: "O app é seguro?",
    a: "Baixe o arquivo somente por esta página, publicada pela sua empresa. Se o seu administrador pedir, confira o SHA-256 em Detalhes da versão.",
  },
  {
    q: "Como atualizar?",
    a: "O app se atualiza sozinho depois de instalado. Se preferir, baixe a versão mais recente por esta página e abra o arquivo.",
  },
] as const;

function Faq({ q, a, defaultOpen }: { q: string; a: string; defaultOpen: boolean }) {
  return (
    <details className="dl-details group rounded-3xl border border-[var(--sf-border)] bg-white shadow-[var(--dl-card-shadow)]" open={defaultOpen}>
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-3xl px-6 py-4 text-lg font-extrabold text-[var(--sf-navy)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--sf-navy)]/40">
        {q}
        <ChevronDown aria-hidden="true" className="dl-chevron size-5 shrink-0 text-[var(--sf-fg-faint)] transition-transform group-open:text-[var(--sf-cta)]" />
      </summary>
      <p className="m-0 px-6 pb-6 text-base leading-relaxed text-[var(--sf-fg-muted)]">{a}</p>
    </details>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className={cn(PILL_OUTLINE, "min-h-11 w-full px-5 text-sm")}>
      {copied ? "Código copiado" : "Copiar código de verificação"}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--sf-border)] py-3 last:border-0">
      <dt className="text-sm text-[var(--sf-fg-muted)]">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-sm font-bold text-[var(--sf-fg)]">{children}</dd>
    </div>
  );
}

function DetailsCard({ item, test }: { item: DownloadItem; test: boolean }) {
  const published = formatDate(item.publishedAt);
  return (
    <section aria-labelledby="dl-details-title" className={cn(CARD, "flex flex-col gap-4 p-7")}>
      <h3 id="dl-details-title" className="m-0 text-xl font-extrabold tracking-tight text-[var(--sf-navy)]">
        Detalhes da versão
      </h3>
      {test ? (
        <p className="m-0 rounded-2xl bg-[var(--sf-cta-weak)] px-4 py-3 text-sm font-semibold text-[var(--dl-red-deep)]">
          <strong className="font-extrabold">Versão de testes:</strong> os pedidos feitos aqui não são lançados de verdade.
        </p>
      ) : null}
      <dl className="m-0">
        <Row label="Versão">
          {item.versionName} ({item.versionCode})
        </Row>
        <Row label="Tamanho">{formatSize(item.sizeBytes)}</Row>
        {published ? <Row label="Publicada em">{published}</Row> : null}
        <Row label="SHA-256">
          <code className="block max-w-[11rem] truncate font-mono text-xs sm:max-w-[16rem]" title={item.sha256}>
            {item.sha256}
          </code>
        </Row>
      </dl>
      {item.notes ? <p className="m-0 text-sm leading-relaxed text-[var(--sf-fg-muted)]">{item.notes}</p> : null}
      <CopyButton value={item.sha256} />
    </section>
  );
}

export function Help({ state, test }: { state: PublishedState; test: boolean }) {
  const showCard = state.kind === "ready" || state.kind === "loading";
  return (
    <Section id="ajuda" labelledBy="dl-help-title" className="bg-[var(--sf-bg)]">
      <div className={cn("mx-auto grid max-w-[1320px] gap-10", showCard && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]")}>
        <div className="flex flex-col gap-4">
          <Reveal>
            <h2 id="dl-help-title" className={cn(H2_LIGHT, "mb-4")}>
              Perguntas frequentes
            </h2>
          </Reveal>
          {FAQ.map((entry, index) => (
            <Faq key={entry.q} q={entry.q} a={entry.a} defaultOpen={index === 0} />
          ))}
        </div>
        {state.kind === "ready" ? <DetailsCard item={state.item} test={test} /> : null}
        {state.kind === "loading" ? (
          <div aria-hidden="true" className={cn(CARD, "flex flex-col gap-4 p-7")}>
            {[0, 1, 2, 3, 4].map((row) => (
              <span key={row} className="h-6 animate-pulse rounded-full bg-[var(--sf-surface-3)]" />
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export function FinalCall({ state }: { state: PublishedState }) {
  const item = state.kind === "ready" ? state.item : null;
  return (
    <Section labelledBy="dl-final-title" className="bg-[linear-gradient(135deg,var(--dl-red-bright),var(--dl-red-dark)_60%,var(--dl-red-darkest))] py-20 text-center text-white md:py-24">
      <CurveArt tone="white" className="top-[28%] h-32 opacity-70" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-8">
        <h2 id="dl-final-title" className="m-0 text-[clamp(30px,5vw,56px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
          Pronto para vender mais rápido?
        </h2>
        {item ? (
          <a
            href={item.url}
            download
            className="inline-flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-white px-9 text-lg font-extrabold text-[var(--dl-red-deep)] shadow-[0_20px_44px_-18px_rgb(0_0_0/0.5)] transition hover:bg-[var(--sf-cta-weak)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--dl-red-dark)]"
          >
            <AndroidIcon className="size-5" />
            Baixar para Android
          </a>
        ) : state.kind === "loading" ? (
          <CtaSkeleton />
        ) : (
          <p className="m-0 text-lg font-semibold text-white">O aplicativo ainda não foi publicado.</p>
        )}
      </div>
    </Section>
  );
}

export function SiteFooter() {
  const link = "inline-flex min-h-11 items-center rounded text-white/85 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return (
    <footer className="relative overflow-hidden bg-[linear-gradient(180deg,var(--sf-navy),var(--dl-night))] px-5 pb-28 pt-16 text-white sm:px-8 md:pb-44">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-[-34px] z-0 select-none text-center text-[150px] font-extrabold leading-none tracking-[-0.04em] text-white/[0.08] md:bottom-[-96px] md:text-[330px]">
        Force
      </div>
      <div className="relative z-10 mx-auto grid max-w-[1320px] gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <img src="/brand/plac-logo.png" alt="PLAC" height={52} className="h-[52px] w-auto self-start rounded-[10px] bg-white" />
          <p className="m-0 text-[13px] font-extrabold uppercase tracking-[0.32em]">Plataforma comercial</p>
          <span aria-hidden="true" className="h-[3px] w-14 bg-[var(--sf-cta)]" />
          <p className="m-0 text-white/80">Artigos para festas &amp; confeitaria</p>
        </div>
        <nav aria-label="Produto" className="flex flex-col gap-1">
          <p className="m-0 mb-2 text-sm font-extrabold uppercase tracking-widest text-white/80">Produto</p>
          <a className={link} href="#baixar">
            Baixar
          </a>
          <Link className={link} to="/login">
            Entrar
          </Link>
          <Link className={link} to="/">
            Abrir no navegador
          </Link>
        </nav>
        <nav aria-label="Ajuda" className="flex flex-col gap-1">
          <p className="m-0 mb-2 text-sm font-extrabold uppercase tracking-widest text-white/80">Ajuda</p>
          <a className={link} href="#instalar">
            Como instalar
          </a>
          <a className={link} href="#ajuda">
            Perguntas frequentes
          </a>
        </nav>
      </div>
      <CurveArt className="bottom-0 z-10 h-20" />
    </footer>
  );
}
