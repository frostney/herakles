import heraklesHeroArt from "../assets/herakles-hero.png" with { type: "file" };
import heraklesMascotArt from "../assets/herakles-mascot.png" with { type: "file" };
import hydraArt from "../assets/hydra.png" with { type: "file" };
import lionArt from "../assets/lion.png" with { type: "file" };
import medusaHeadArt from "../assets/medusa-head.png" with { type: "file" };
import owlArt from "../assets/owl.png" with { type: "file" };
export const assets = {
  heraklesHero: heraklesHeroArt,
  heraklesMascot: heraklesMascotArt,
  hydra: hydraArt,
  lion: lionArt,
  medusaHead: medusaHeadArt,
  owl: owlArt,
};

export function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const ui = {
  appShell:
    "grid h-dvh min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-[var(--surface-app)] bg-[image:var(--tex-knit)] bg-[length:var(--tex-knit-size)] text-[var(--text-body)] max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]",
  sidebar:
    "flex min-h-0 flex-col gap-[var(--space-4)] overflow-y-auto border-r-2 border-dashed border-[var(--thread)] bg-[var(--surface-sunken)] bg-[image:var(--tex-knit)] bg-[length:var(--tex-knit-size)] p-[var(--space-4)] max-[900px]:border-r-0 max-[900px]:border-b-2 max-[900px]:p-[var(--space-3)]",
  brand:
    "flex items-center gap-[var(--space-2_5)] px-[var(--space-2)] pb-[var(--space-5)] pt-[var(--space-2)]",
  brandImage: "h-10 w-10 object-contain drop-shadow-[0_4px_6px_rgb(0_0_0_/_0.45)]",
  brandTitle: "font-display text-[1.8rem] leading-none font-bold text-[var(--text-strong)]",
  brandSubtitle:
    "mt-0.5 block font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  nav: "grid gap-[3px]",
  navLink:
    "flex min-h-10 items-center gap-[var(--space-3)] rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2_5)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] transition-[background-color,color,transform,box-shadow] hover:bg-[var(--primary-soft)] hover:text-[var(--text-strong)] active:translate-y-px",
  navLinkActive:
    "bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_3px_0_var(--primary-shade)] hover:bg-[var(--primary-hover)] hover:text-[var(--on-primary)] active:translate-y-[2px] active:shadow-[0_1px_0_var(--primary-shade)]",
  sidebarFooter: "mt-auto grid gap-[var(--space-3)]",
  serverChip:
    "flex min-h-[var(--control-lg)] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] px-[var(--space-3)] py-[var(--space-2)] shadow-[0_3px_0_var(--lift-edge)]",
  chipTitle: "block font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]",
  chipText: "block font-mono text-[var(--text-2xs)] text-[var(--text-faint)]",
  content: "flex min-h-0 min-w-0 flex-col overflow-hidden",
  topbar:
    "flex flex-none items-center gap-[var(--space-3)] border-b-2 border-dashed border-[var(--thread)] bg-[var(--surface-app)]/90 px-[var(--space-5)] py-[var(--space-4)] backdrop-blur max-[820px]:flex-col max-[820px]:items-stretch max-[820px]:px-[var(--space-4)]",
  commandTrigger:
    "inline-flex min-h-[var(--control-md)] min-w-[280px] max-w-[520px] flex-1 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] text-left text-[var(--text-muted)] shadow-[inset_0_2px_5px_rgb(0_0_0_/_0.18)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-strong)] max-[820px]:min-w-0 max-[820px]:max-w-none",
  eventBanner:
    "ml-auto grid max-w-[520px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--info-soft-border)] bg-[var(--info-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] max-[820px]:ml-0 max-[820px]:max-w-none",
  screenHeader:
    "flex flex-none items-start justify-between gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-5)] max-[820px]:flex-col max-[820px]:px-[var(--space-4)]",
  screenEyebrow:
    "mb-1 font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  screenTitle:
    "m-0 font-display text-[clamp(2rem,5vw,3.75rem)] leading-[0.92] font-bold text-[var(--text-strong)]",
  screenSubtitle: "mt-2 block max-w-[720px] text-[var(--text-md)] text-[var(--text-muted)]",
  view: "grid min-h-0 min-w-0 flex-1 auto-rows-min content-start gap-[var(--space-5)] overflow-auto px-[var(--space-5)] pb-[var(--space-6)] max-[820px]:px-[var(--space-4)]",
  actions: "flex flex-wrap items-center gap-[var(--space-2)]",
  button:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--text-strong)] shadow-[0_4px_0_var(--lift-edge),0_6px_12px_rgb(0_0_0_/_0.22)] transition-[background-color,border-color,color,transform,box-shadow] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-25 hover:border-[var(--border-strong)] hover:bg-[var(--surface-overlay)] active:translate-y-[2px] active:shadow-[0_2px_0_var(--lift-edge),0_3px_8px_rgb(0_0_0_/_0.18)] disabled:cursor-not-allowed disabled:opacity-60",
  buttonPrimary:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--primary-shade)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--on-primary)] shadow-[0_4px_0_var(--primary-shade),0_6px_12px_rgb(0_0_0_/_0.28)] transition-[background-color,border-color,color,transform,box-shadow] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-30 hover:bg-[var(--primary-hover)] active:translate-y-[2px] active:shadow-[0_2px_0_var(--primary-shade),0_3px_8px_rgb(0_0_0_/_0.22)] disabled:cursor-not-allowed disabled:opacity-60",
  buttonGhost:
    "inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-transparent bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)] shadow-none transition-[background-color,color,transform] hover:bg-[var(--neutral-soft)] hover:text-[var(--text-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
  buttonDanger:
    "relative inline-flex min-h-[var(--control-md)] cursor-pointer items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border-[1.5px] border-[var(--danger-soft-border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-sm)] font-bold text-[var(--danger-strong)] shadow-none transition-[background-color,border-color,color,transform] after:pointer-events-none after:absolute after:inset-1 after:rounded-[calc(var(--radius-md)-4px)] after:border after:border-dashed after:border-current after:opacity-25 hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60",
  iconButton:
    "inline-flex h-[var(--control-md)] w-[var(--control-md)] cursor-pointer items-center justify-center rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-[var(--text-muted)] shadow-none transition-[background-color,color,transform] hover:bg-[var(--neutral-soft)] hover:text-[var(--text-strong)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-60",
  panel:
    "min-w-0 rounded-[var(--radius-lg)] border-[1.5px] border-[var(--border-subtle)] bg-[var(--surface-card)] p-[var(--space-5)] shadow-[var(--lift-1)]",
  panelHead:
    "mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] max-[820px]:flex-col max-[820px]:items-stretch",
  panelTitle: "m-0 font-display text-[var(--text-2xl)] font-bold text-[var(--text-strong)]",
  metrics: "flex flex-wrap items-start gap-x-[var(--space-10)] gap-y-[var(--space-5)]",
  list: "grid gap-[var(--space-2)]",
  listRow:
    "flex min-w-0 items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-card)] px-[var(--space-3)] py-[var(--space-3)] shadow-[var(--lift-1)] max-[720px]:flex-col max-[720px]:items-stretch",
  listRowMain: "min-w-0 grid gap-1",
  listTitle: "font-sans text-[var(--text-sm)] font-semibold text-[var(--text-strong)]",
  muted: "text-[var(--text-muted)]",
  mono: "font-mono text-[var(--text-xs)] text-[var(--text-faint)]",
  link: "text-[var(--primary-hover)] underline decoration-[var(--primary-soft-border)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--primary)] hover:decoration-[var(--primary)] focus:outline-none focus-visible:rounded-[var(--radius-xs)] focus-visible:shadow-[var(--ring)]",
  emptyText:
    "rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-4)] text-center text-[var(--text-muted)]",
  input:
    "min-h-[var(--control-md)] w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[var(--text-base)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60",
  textarea:
    "min-h-32 w-full rounded-[var(--radius-md)] border-[1.5px] border-[var(--border-default)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--text-sm)] text-[var(--text-strong)] shadow-[inset_0_2px_4px_rgb(0_0_0_/_0.18)] transition-colors placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--border-focus)] focus:outline-none focus:shadow-[0_0_0_3px_var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-60",
  label:
    "grid gap-[var(--space-1_5)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)]",
  labelText:
    "font-mono text-[var(--text-2xs)] tracking-[var(--tracking-caps)] text-[var(--text-faint)] uppercase",
  checkboxLabel:
    "inline-flex min-h-[var(--control-md)] items-center gap-[var(--space-2)] font-sans text-[var(--text-sm)] font-semibold text-[var(--text-muted)]",
  checkbox:
    "h-4 w-4 min-h-0 rounded-[var(--radius-xs)] border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-inset)] p-0 accent-[var(--primary)] shadow-none",
  tableWrap:
    "min-w-0 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)]",
  table:
    "w-full min-w-[680px] border-collapse text-left text-[var(--text-sm)] [&_td]:border-b [&_td]:border-[var(--border-subtle)] [&_td]:px-[var(--space-3)] [&_td]:py-[var(--space-3)] [&_td]:align-top [&_th]:border-b [&_th]:border-[var(--border-default)] [&_th]:px-[var(--space-3)] [&_th]:py-[var(--space-2)] [&_th]:text-left [&_th]:font-mono [&_th]:text-[var(--text-2xs)] [&_th]:font-semibold [&_th]:tracking-[var(--tracking-caps)] [&_th]:text-[var(--text-faint)] [&_th]:uppercase [&_tr:last-child_td]:border-b-0",
  detailGrid: "grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[var(--space-3)]",
  detailItem:
    "grid gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-3)]",
  stateGrid: "grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-[var(--space-3)]",
  stateRow:
    "flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-[var(--space-3)] py-[var(--space-3)]",
  codeBlock:
    "max-h-[360px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-[var(--space-3)] font-mono text-[var(--text-xs)] text-[var(--text-strong)] whitespace-pre-wrap",
  formGrid: "grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[var(--space-3)]",
};

export const feedbackClass = {
  success:
    "rounded-[var(--radius-md)] border border-[var(--success-soft-border)] bg-[var(--success-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--success-strong)]",
  error:
    "rounded-[var(--radius-md)] border border-[var(--danger-soft-border)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--danger-strong)]",
  warning:
    "rounded-[var(--radius-md)] border border-[var(--warning-soft-border)] bg-[var(--warning-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--warning)]",
} as const;

export function feedbackToneClass(tone: "success" | "error" | "warning") {
  return feedbackClass[tone];
}
