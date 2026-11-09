import type { ReactNode } from "react";

/** Moldura padrão das telas: título, descrição opcional, ações à direita. */
export function Page({
  title,
  description,
  actions,
  children,
  width = "max-w-4xl",
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className={`mx-auto w-full ${width} px-5 py-6 md:px-10 md:py-9`}>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-[1.75rem] leading-tight font-bold">{title}</h1>
          {description && <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/** Seção sem "cartão": título + conteúdo, separada por espaço e uma linha fina. */
export function Section({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="border-t border-border py-7 [header+&]:border-t-0 [header+&]:pt-0 [form>&:first-of-type]:border-t-0 [form>&:first-of-type]:pt-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
