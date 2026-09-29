import Link from 'next/link'

/**
 * Every entry on the Settings screen has one shape, whether it opens a screen
 * (SettingsLinkCard) or unfolds in place (a Disclosure with SettingsSummary):
 * title, one line of description, an optional count, and a chevron. The
 * chevron points right for a link and turns down when a panel is open.
 */
function Row({
  title, description, meta, warning, chevron,
}: {
  title: string
  description: string
  meta?: string
  warning?: string
  chevron: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-[1.0625rem] font-semibold">{title}</span>
          {meta ? <span className="text-[0.875rem] font-normal opacity-80">{meta}</span> : null}
        </div>
        <p className="text-[0.9375rem] font-normal opacity-80">{description}</p>
        {warning ? <p className="text-[0.875rem] font-semibold text-warn">{warning}</p> : null}
      </div>
      <svg aria-hidden="true" viewBox="0 0 20 20" className={`size-5 shrink-0 opacity-70 ${chevron}`}>
        <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

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
      className="ir-card p-4 text-ink transition-colors duration-150 ease-ui hover:bg-brand-tint"
    >
      <Row title={title} description={description} meta={meta} warning={warning} chevron="" />
    </Link>
  )
}

/** The summary for a Disclosure given `className="group"`, so the chevron can turn. */
export function SettingsSummary({ title, description }: { title: string; description: string }) {
  return (
    <Row
      title={title}
      description={description}
      chevron="transition-transform duration-150 group-open:rotate-90"
    />
  )
}
