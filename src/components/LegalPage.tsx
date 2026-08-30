import { getTranslations } from 'next-intl/server'

export type Section = string

/**
 * Privacy and terms are real pages with real content, not placeholders — but
 * the company's registered details and the rental terms themselves are still
 * outstanding from the client (HANDOFF.md, "Blocked on the client" §7), so the
 * draft notice stays up until they arrive.
 */
export async function LegalPage({
  title, namespace, sections, notice,
}: {
  title: string
  namespace: string
  sections: Section[]
  notice: string
}) {
  const t = await getTranslations(namespace)

  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
      <h1 className="text-[1.75rem] font-bold tracking-tight">{title}</h1>

      <p className="ir-notice mt-4 border-warn bg-warn-tint text-ink">{notice}</p>

      <div className="mt-6 flex flex-col gap-6">
        {sections.map((key) => (
          <section key={key} aria-labelledby={`s-${key}`}>
            <h2 id={`s-${key}`} className="text-[1.125rem] font-semibold">
              {t(`${key}Title`)}
            </h2>
            <p className="mt-1.5 text-ink-soft">{t(key)}</p>
          </section>
        ))}
      </div>
    </main>
  )
}
