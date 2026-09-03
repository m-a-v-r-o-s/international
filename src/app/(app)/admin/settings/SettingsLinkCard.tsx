import Link from 'next/link'

/**
 * A setting big enough to need its own screen — a list, a multi-field form,
 * or both — gets a card here instead of being shown inline. The whole card is
 * the tap target (WCAG's 44px minimum), but the title is what reads as the
 * link: brand-coloured and underlined, the same way every other in-app link
 * is styled.
 */
export function SettingsLinkCard({
  href, title, description, meta, warning,
}: {
  href: string
  title: string
  description: string
  meta?: string
  warning?: string
}) {
  return (
    <Link
      href={href}
      className="ir-card flex flex-col gap-1.5 p-4 transition-colors duration-150 ease-ui hover:bg-brand-tint"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[1.0625rem] font-semibold text-brand underline underline-offset-2">
          {title}
        </span>
        {meta ? <span className="text-[0.875rem] text-ink-soft">{meta}</span> : null}
      </div>
      <p className="text-[0.9375rem] text-ink-soft">{description}</p>
      {warning ? <p className="text-[0.875rem] font-semibold text-warn">{warning}</p> : null}
    </Link>
  )
}
