import { cn } from "@salesforce/ui";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatSize, type DownloadItem } from "../../lib/downloads";
import {
  AndroidIcon,
  Blob,
  BrowserMock,
  BubbleArt,
  GearArt,
  OfflineIcon,
  OrderBoxArt,
  OrderIcon,
  PhoneMock,
  PhotoIcon,
  Section,
  UpdateIcon,
} from "./art";
import { PILL_GHOST, PILL_LIGHT, PILL_OFF, PILL_SOLID, PrimaryCta, type PublishedState } from "./cta";
import { Reveal, useInView } from "./use-in-view";

const NIGHT = "bg-[var(--dl-ink-2)]";
const BLACK = "bg-[var(--dl-ink)]";
export const H2 = "m-0 text-[clamp(40px,6vw,72px)] font-black uppercase leading-[0.98] tracking-[-0.02em] text-balance";
const LEAD = "m-0 max-w-xl text-lg leading-relaxed text-white/80 sm:text-xl";

const NAV = [
  { href: "#celular", label: "Baixar" },
  { href: "#beneficios", label: "Benefícios" },
  { href: "#como-instalar", label: "Como instalar" },
  { href: "#ajuda", label: "Ajuda" },
] as const;

export function TopBar() {
  // Transparent over the hero; a soft scrim once the page scrolls so the pills never sit on top of body text.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 transition-colors sm:px-6",
        scrolled && "bg-[var(--dl-ink)]/85 backdrop-blur",
      )}
    >
      <Link
        to="/downloads"
        className="inline-flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-4 text-lg font-black tracking-tight text-[var(--sf-fg)] shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
        aria-label="Force"
      >
        <img src="/brand/icon-p.png" alt="" width={32} height={32} className="size-8 rounded-full" />
        Force
      </Link>
      <nav aria-label="Seções da página" className="hidden items-center gap-1 rounded-full bg-[var(--dl-ink)]/50 p-1 backdrop-blur md:flex">
        {NAV.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-full px-4 py-2 text-sm font-bold text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {link.label}
          </a>
        ))}
      </nav>
      <Link
        to="/login"
        className="inline-flex min-h-10 items-center rounded-full bg-white px-5 text-sm font-extrabold text-[var(--sf-fg)] shadow-lg hover:bg-[var(--sf-cta-weak)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
      >
        Entrar
      </Link>
    </header>
  );
}

export function Hero({ state, onRetry, retrying }: { state: PublishedState; onRetry: () => void; retrying: boolean }) {
  const [heroRef, heroVisible] = useInView<HTMLElement>({ threshold: 0.5 });
  return (
    <>
      <section
        id="hero"
        ref={heroRef}
        aria-labelledby="dl-hero-title"
        className="relative overflow-hidden bg-[linear-gradient(180deg,var(--sf-red-strong)_0%,var(--dl-wine)_48%,var(--dl-ink)_100%)] flex min-h-[100svh] flex-col px-5 pt-28 text-center text-white sm:px-8 sm:pt-32"
      >
        <Blob className="-left-24 top-24 size-[420px] bg-[var(--sf-red)]/35" />
        <Blob className="-right-20 top-[38%] size-[380px] bg-[var(--sf-red)]/40" />
        <Blob className="left-[35%] top-[-120px] size-[320px] bg-white/15" />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-6">
          <h1 id="dl-hero-title" className="m-0 text-[clamp(40px,9vw,96px)] font-black uppercase leading-[0.96] tracking-[-0.025em] text-balance">
            Baixe o Force onde você estiver
          </h1>
          <p className="m-0 max-w-2xl text-lg leading-relaxed text-white/90 sm:text-xl">
            Seus pedidos no bolso. Funciona mesmo sem internet. Disponível para Android, com iPhone em breve.
          </p>
          <PrimaryCta state={state} large className="w-full max-w-sm" />
          {state.kind === "none" ? <p className="m-0 text-sm text-white/80">Nenhuma versão disponível ainda. Volte em breve.</p> : null}
          {state.kind === "error" ? (
            <p role="alert" className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-black/30 px-4 py-2 text-sm text-white">
              Não foi possível carregar a lista de downloads.
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="rounded-full font-extrabold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70"
              >
                {retrying ? "Tentando…" : "Tentar de novo"}
              </button>
            </p>
          ) : null}
        </div>
        <div className="relative mx-auto mt-auto w-full max-w-[820px] pt-14 sm:pt-16">
          <OrderBoxArt className="dl-float absolute left-0 top-2 z-10 w-14 sm:left-2 sm:w-24 md:-left-4 md:top-4 md:w-32 [--dl-rot:-8deg]" />
          <BubbleArt className="dl-float-slow absolute right-0 top-4 z-10 w-14 sm:right-2 sm:w-24 md:-right-4 md:top-12 md:w-32 [--dl-rot:6deg]" />
          <div className="mx-auto h-[230px] w-[300px] overflow-hidden sm:h-[330px] sm:w-[420px] md:h-[350px]">
            <PhoneMock className="mx-auto w-[300px] sm:w-[420px]" />
          </div>
        </div>
      </section>
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex justify-center border-t border-white/15 bg-[var(--dl-ink)]/92 px-4 pb-4 pt-3 backdrop-blur transition duration-300 md:hidden",
          heroVisible ? "translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-full opacity-0",
        )}
      >
        <div className="w-full max-w-sm">
          <PrimaryCta state={state} className="w-full [&>span:last-child]:hidden" />
        </div>
      </div>
    </>
  );
}

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-[420px] justify-center overflow-hidden rounded-[36px] bg-[linear-gradient(135deg,var(--sf-red-strong)_0%,var(--dl-wine)_55%,var(--dl-ink)_100%)] pt-10 sm:h-[560px] sm:rounded-[40px]",
        className,
      )}
    >
      <Blob className="-left-10 -top-10 size-64 bg-white/25" />
      <Blob className="-bottom-16 -right-10 size-64 bg-[var(--sf-red)]/45" />
      {children}
    </div>
  );
}

export function PhoneSection({ state }: { state: PublishedState }) {
  return (
    <Section id="celular" labelledBy="dl-phone-title" className={cn(BLACK, "text-white")}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <Frame>
            <PhoneMock className="relative w-[250px] sm:w-[340px] [--dl-rot:-3deg] dl-float-slow" />
          </Frame>
        </Reveal>
        <Reveal delay={120} className="flex flex-col items-start gap-6">
          <h2 id="dl-phone-title" className={H2}>
            Baixe para celular
          </h2>
          <p className={LEAD}>Faça pedidos, consulte o catálogo com fotos e acompanhe o status de cada nota, onde estiver.</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
            {state.kind === "ready" ? (
              <a href={state.item.url} download className={PILL_SOLID}>
                <AndroidIcon className="size-5" />
                Baixar APK (Android)
              </a>
            ) : (
              <button type="button" disabled className={PILL_OFF}>
                <AndroidIcon className="size-5" />
                Baixar APK (Android) - em breve
              </button>
            )}
            <button type="button" disabled className={PILL_OFF}>
              App Store - em breve
            </button>
            <button type="button" disabled className={PILL_OFF}>
              Google Play - em breve
            </button>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function WebSection() {
  return (
    <Section id="web" labelledBy="dl-web-title" className={cn(NIGHT, "text-white")}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal className="order-2 flex flex-col items-start gap-6 lg:order-1">
          <h2 id="dl-web-title" className={H2}>
            No computador, é só abrir
          </h2>
          <p className={LEAD}>O Force também funciona no navegador, sem instalar nada.</p>
          <Link to="/" className={PILL_LIGHT}>
            Abrir o Force no navegador
          </Link>
        </Reveal>
        <Reveal delay={120} className="order-1 lg:order-2">
          <Frame className="items-center px-5 pt-0 sm:px-10">
            <BrowserMock className="relative -rotate-2" />
          </Frame>
        </Reveal>
      </div>
    </Section>
  );
}

const BENEFITS = [
  { title: "Funciona offline", text: "Registre pedidos sem sinal. Tudo segue quando a conexão voltar.", Icon: OfflineIcon },
  { title: "Catálogo com fotos", text: "Mostre o produto ao cliente antes de fechar a venda.", Icon: PhotoIcon },
  { title: "Pedido direto no Sankhya", text: "Pedido que vai direto para o Sankhya.", Icon: OrderIcon },
  { title: "Atualiza sozinho", text: "As novas versões chegam ao app sem você fazer nada.", Icon: UpdateIcon },
] as const;

export function Benefits() {
  return (
    <Section id="beneficios" labelledBy="dl-benefits-title" className="bg-[var(--sf-bg)] text-[var(--sf-fg)]">
      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <h2 id="dl-benefits-title" className={cn(H2, "mx-auto max-w-3xl text-center")}>
            Feito para o dia a dia da venda
          </h2>
        </Reveal>
        <ul className="m-0 mt-14 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ title, text, Icon }, index) => (
            <li key={title}>
              <Reveal delay={index * 80} className="h-full">
                <div className="flex h-full flex-col gap-4 rounded-[28px] border border-[var(--sf-border)] bg-white p-7 shadow-[var(--sf-shadow-1)]">
                  <span className="grid size-24 place-items-center rounded-[28px] bg-[linear-gradient(135deg,var(--sf-red-strong),var(--dl-wine))] text-white">
                    <Icon className="size-14" />
                  </span>
                  <h3 className="m-0 text-2xl font-extrabold leading-tight text-[var(--sf-fg)]">{title}</h3>
                  <p className="m-0 text-base leading-relaxed text-[var(--sf-fg-muted)]">{text}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** Shown only when the newest published build comes from a test channel (see `isTestChannel` in downloads.tsx). */
export function Experimental() {
  return (
    <Section id="experimental" labelledBy="dl-test-title" className={cn(BLACK, "pb-36 text-center text-white sm:pb-28")}>
      <Blob className="left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 bg-[var(--sf-red)]/25" />
      <OrderBoxArt className="dl-float absolute left-[6%] top-10 w-16 opacity-90 sm:w-24 [--dl-rot:-10deg]" />
      <BubbleArt className="dl-float-slow absolute right-[8%] top-16 w-16 opacity-90 sm:w-24 [--dl-rot:8deg]" />
      <GearArt className="dl-float absolute bottom-5 right-[8%] w-12 opacity-90 sm:bottom-8 sm:right-[18%] sm:w-20" />
      <OrderBoxArt className="dl-float-slow absolute bottom-10 left-[14%] hidden w-16 opacity-80 sm:block [--dl-rot:12deg]" />
      <Reveal className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
        <h2 id="dl-test-title" className={H2}>
          Versão de testes
        </h2>
        <p className={LEAD}>Este é o ambiente de testes: os pedidos feitos aqui não são lançados de verdade.</p>
      </Reveal>
    </Section>
  );
}

const STEPS = [
  "Abra esta página no celular e toque em Baixar para Android.",
  "Ao abrir o arquivo, permita a instalação de apps desta origem quando o Android pedir.",
  "Abra o Force e entre com o seu usuário. O app se atualiza sozinho.",
] as const;

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

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="dl-details group rounded-3xl border border-white/15 bg-white/[0.06]"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-3xl px-6 py-4 text-lg font-extrabold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70">
        {title}
        <ChevronDown aria-hidden="true" className="dl-chevron size-5 shrink-0 transition-transform" />
      </summary>
      <div className="px-6 pb-6 text-base leading-relaxed text-white/80">{children}</div>
    </details>
  );
}

export function HowTo({ item }: { item: DownloadItem | null }) {
  const published = item ? formatDate(item.publishedAt) : null;
  return (
    <Section id="como-instalar" labelledBy="dl-how-title" className={cn(NIGHT, "text-white")}>
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 id="dl-how-title" className={H2}>
            Como instalar
          </h2>
        </Reveal>
        <ol className="m-0 mt-12 grid list-none gap-5 p-0 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step}>
              <Reveal delay={index * 90} className="h-full">
                <div className="flex h-full flex-col gap-3 rounded-[28px] bg-white/[0.07] p-7">
                  <span aria-hidden="true" className="text-[88px] font-black leading-none text-[var(--sf-red)]">
                    {index + 1}
                  </span>
                  <p className="m-0 text-lg leading-relaxed text-white/90">{step}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
        <div id="ajuda" className="mt-16 flex scroll-mt-24 flex-col gap-3">
          <h3 className="m-0 mb-2 text-3xl font-black uppercase tracking-tight">Perguntas frequentes</h3>
          {FAQ.map((entry) => (
            <Disclosure key={entry.q} title={entry.q}>
              <p className="m-0">{entry.a}</p>
            </Disclosure>
          ))}
          {item ? (
            <Disclosure title="Detalhes da versão">
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <dt className="text-sm text-white/70">Versão</dt>
                  <dd className="m-0 font-bold text-white">
                    {item.versionName} ({item.versionCode})
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-white/70">Tamanho</dt>
                  <dd className="m-0 font-bold text-white">{formatSize(item.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-white/70">Canal</dt>
                  <dd className="m-0 font-bold text-white">{item.channel}</dd>
                </div>
                {published ? (
                  <div>
                    <dt className="text-sm text-white/70">Publicado em</dt>
                    <dd className="m-0 font-bold text-white">{published}</dd>
                  </div>
                ) : null}
              </dl>
              {item.notes ? <p className="m-0 mt-4">{item.notes}</p> : null}
              <p className="m-0 mt-4 break-all text-sm">
                SHA-256: <code className="font-mono text-white">{item.sha256}</code>
              </p>
            </Disclosure>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

export function SiteFooter({ item }: { item: DownloadItem | null }) {
  const link = "rounded text-white/85 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return (
    <footer className="relative overflow-hidden bg-[linear-gradient(180deg,var(--dl-ink)_0%,var(--dl-wine)_55%,var(--sf-red-strong)_100%)] px-5 pt-20 text-white sm:px-8">
      <div className="relative mx-auto flex max-w-6xl flex-col gap-12">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex flex-col gap-3 md:col-span-2">
            <span className="inline-flex items-center gap-2 text-2xl font-black">
              <img src="/brand/icon-p.png" alt="" width={36} height={36} className="size-9 rounded-full" />
              Force
            </span>
            <p className="m-0 max-w-sm text-white/80">Seus pedidos no bolso, mesmo sem internet.</p>
            {item ? (
              <p className="m-0 text-sm text-white/80">
                Versão do app: {item.versionName} ({item.versionCode})
              </p>
            ) : null}
          </div>
          <nav aria-label="Produto" className="flex flex-col gap-3">
            <p className="m-0 text-sm font-extrabold uppercase tracking-widest text-white/80">Produto</p>
            <a className={link} href="#celular">
              Baixar
            </a>
            <Link className={link} to="/login">
              Entrar
            </Link>
          </nav>
          <nav aria-label="Ajuda" className="flex flex-col gap-3">
            <p className="m-0 text-sm font-extrabold uppercase tracking-widest text-white/80">Ajuda</p>
            <a className={link} href="#como-instalar">
              Como instalar
            </a>
            <a className={link} href="#ajuda">
              FAQ
            </a>
          </nav>
        </div>
        <div>
          <Link to="/login" className={cn(PILL_GHOST, "min-h-11 text-sm")}>
            Voltar ao login
          </Link>
        </div>
      </div>
      <div aria-hidden="true" className="relative mt-6 h-[clamp(90px,19vw,290px)] select-none overflow-hidden">
        <span className="block text-center text-[clamp(140px,34vw,520px)] font-black leading-[0.8] tracking-[-0.04em] text-white/40">Force</span>
      </div>
    </footer>
  );
}
