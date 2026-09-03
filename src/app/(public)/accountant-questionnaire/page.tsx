import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { issueStamp } from '@/lib/accountant/stamp'
import {
  ASSUMPTIONS, CHECKLIST, INTRO, REFERENCES, SECTIONS, pick,
} from '@/lib/accountant/questionnaire'
import { QuestionnaireForm } from './QuestionnaireForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('accountant')
  return {
    title: t('title'),
    // A public URL the accountant is sent directly. It is not a page anyone
    // should arrive at from a search result, and it carries the company's tax
    // position in the questions themselves.
    robots: { index: false, follow: false },
  }
}

/**
 * /accountant-questionnaire — the seventeen questions from
 * src/lib/accountant/questionnaire.ts as a form the company's accountant can
 * actually fill in, rather than a PDF they have to print.
 *
 * PUBLIC, ON PURPOSE, AND THE OWNER CHOSE IT. The alternatives were a
 * tokenised link and a fourth role; a plain URL he can paste into an email
 * won. That decision is why src/lib/accountant/stamp.ts exists and why
 * actions.ts is written the way it is. `robots: noindex` above is not access
 * control and is not treated as any: it keeps the page out of search results,
 * nothing more.
 *
 * The page renders whole at rest. Every question is on screen with its answer
 * box open: an accountant working through this wants to see the shape of what
 * is being asked before starting, and an accordion would hide exactly the
 * thing they are judging.
 */
export default async function AccountantQuestionnairePage() {
  const t = await getTranslations('accountant')
  const locale = await getLocale()
  const stamp = await issueStamp()

  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <header className="border-b border-line pb-6">
        <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 text-[1.875rem] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-[1.0625rem] text-ink-soft">{t('standfirst')}</p>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[0.9375rem]">
          <dt className="font-semibold text-ink-soft">{t('metaFromLabel')}</dt>
          <dd>{t('metaFrom')}</dd>
          <dt className="font-semibold text-ink-soft">{t('metaSubjectLabel')}</dt>
          <dd>{t('metaSubject')}</dd>
          <dt className="font-semibold text-ink-soft">{t('metaAskLabel')}</dt>
          <dd>{t('metaAsk')}</dd>
        </dl>
      </header>

      <p className="mt-6 text-ink-soft">{pick(INTRO, locale)}</p>

      <QuestionnaireForm
        stamp={stamp}
        locale={locale}
        assumptions={ASSUMPTIONS.map((a) => ({
          id: a.id,
          heading: pick(a.heading, locale),
          body: pick(a.body, locale),
          ask: pick(a.ask, locale),
        }))}
        sections={SECTIONS.map((s) => ({
          id: s.id,
          mark: s.mark,
          title: pick(s.title, locale),
          lede: pick(s.lede, locale),
          questions: s.questions.map((q) => ({
            id: q.id,
            number: q.number,
            text: pick(q.text, locale),
            why: q.why ? pick(q.why, locale) : undefined,
          })),
        }))}
        checklist={CHECKLIST.map((c) => ({
          id: c.id,
          label: pick(c.label, locale),
          hint: c.hint ? pick(c.hint, locale) : undefined,
        }))}
      />

      <section aria-labelledby="refs" className="mt-10 border-t border-line pt-5">
        <h2 id="refs" className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          {t('referencesTitle')}
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-[0.875rem] text-ink-soft">
          {REFERENCES.map((reference) => (
            <li key={reference.en}>{pick(reference, locale)}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
