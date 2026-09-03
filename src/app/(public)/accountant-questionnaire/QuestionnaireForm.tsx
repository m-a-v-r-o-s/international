'use client'

import { useActionState, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { submitReply, type ReplyState } from './actions'

type Assumption = { id: string; heading: string; body: string; ask: string }
type Question = { id: string; number: number; text: string; why?: string }
type Section = { id: string; mark: string; title: string; lede: string; questions: Question[] }
type ChecklistItem = { id: string; label: string; hint?: string }

const EMPTY: ReplyState = {}

/**
 * These three mirror actions.ts, which is the one that actually refuses. They
 * exist here so the accountant is told before they submit rather than after:
 * an over-budget POST would otherwise be a framework 413, which is a dead page
 * with their seventeen answers still in it. Client-side checking is UX here,
 * never the control (docs/03-SECURITY.md).
 */
const MAX_FILES = 6
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 9 * 1024 * 1024

/**
 * The form half of /accountant-questionnaire.
 *
 * The content arrives already resolved to one language: the page picked it
 * from the bilingual pairs in src/lib/accountant/questionnaire.ts, so nothing
 * in here decides what anything says. The chrome comes from the catalogues.
 *
 * WHY EVERY ANSWER IS A TEXTAREA AND NOTHING IS REQUIRED. An accountant
 * answering seventeen questions about their client's books will not have all
 * seventeen answers to hand, and a form that refuses to submit until it is
 * complete gets abandoned at question nine with nothing recorded. Partial
 * answers are worth having, and the transcript that reaches the office marks
 * which ones were skipped, so a half-filled reply is still useful and still
 * legible. The action's only "did you actually fill anything in" check is that
 * the whole thing is not empty.
 */
export function QuestionnaireForm({
  stamp, locale, assumptions, sections, checklist,
}: {
  stamp: string
  locale: string
  assumptions: Assumption[]
  sections: Section[]
  checklist: ChecklistItem[]
}) {
  const t = useTranslations('accountant')
  const [state, action] = useActionState(submitReply, EMPTY)
  const [fileProblem, setFileProblem] = useState<'count' | 'size' | null>(null)

  if (state.done) return <Thanks />

  return (
    <form action={action} className="mt-8 flex flex-col gap-10" noValidate>
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="locale" value={locale} />
      <Honeypot />

      <section aria-labelledby="s-assumptions" className="flex flex-col gap-5">
        <div>
          <SectionHeading id="s-assumptions" mark="Α" title={t('assumptionsTitle')} />
          <p className="mt-1.5 text-[0.9375rem] text-ink-soft">{t('assumptionsLede')}</p>
        </div>

        {assumptions.map((assumption) => (
          <div key={assumption.id} className="ir-card p-4">
            <h3 className="text-[0.8125rem] font-bold uppercase tracking-[0.1em] text-brand">
              {assumption.heading}
            </h3>
            <p className="mt-2 text-ink-soft">{assumption.body}</p>
            <p className="mt-2.5 font-medium">{assumption.ask}</p>
            <Answer id={assumption.id} label={t('answerLabel')} rows={3} />
          </div>
        ))}
      </section>

      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`s-${section.id}`} className="flex flex-col gap-7">
          <div>
            <SectionHeading id={`s-${section.id}`} mark={section.mark} title={section.title} />
            <p className="mt-1.5 text-[0.9375rem] text-ink-soft">{section.lede}</p>
          </div>

          {section.questions.map((question) => (
            <div key={question.id} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span
                aria-hidden="true"
                className="text-right text-[1.0625rem] font-bold tabular-nums text-brand"
              >
                {question.number}
              </span>
              <div>
                {/* The number is decorative in the layout but part of the
                    accessible name, so a screen reader announces "6." with the
                    question rather than reading a bare digit in its own cell. */}
                <p className="text-[1.0625rem]">
                  <span className="sr-only">{`${question.number}. `}</span>
                  {question.text}
                </p>
                {question.why ? (
                  <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-soft">{question.why}</p>
                ) : null}
                <Answer id={question.id} label={t('answerLabel')} rows={3} />
              </div>
            </div>
          ))}
        </section>
      ))}

      <section aria-labelledby="s-files" className="flex flex-col gap-4">
        <div>
          <SectionHeading id="s-files" mark="ΣΤ" title={t('filesTitle')} />
          <p className="mt-1.5 text-[0.9375rem] text-ink-soft">{t('filesLede')}</p>
        </div>

        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {checklist.map((item) => (
            <li key={item.id} className="py-3">
              <p>{item.label}</p>
              {item.hint ? <p className="mt-0.5 text-[0.875rem] text-ink-soft">{item.hint}</p> : null}
            </li>
          ))}
        </ul>

        <FileField
          label={t('filesLabel')}
          hint={t('filesHint', { max: MAX_FILES, mb: MAX_TOTAL_FILE_BYTES / (1024 * 1024) })}
          onProblem={setFileProblem}
        />
      </section>

      <section aria-labelledby="s-you" className="flex flex-col gap-4">
        <SectionHeading id="s-you" mark="Ζ" title={t('youTitle')} />

        <div>
          <label className="ir-label" htmlFor="name">{t('nameLabel')}</label>
          <input id="name" name="name" className="ir-field" maxLength={120} autoComplete="name" />
        </div>
        <div>
          <label className="ir-label" htmlFor="email">{t('emailLabel')}</label>
          <input
            id="email" name="email" type="email" inputMode="email" className="ir-field"
            maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false}
          />
          <p className="ir-hint">{t('emailHint')}</p>
        </div>
        <div>
          <label className="ir-label" htmlFor="note">{t('noteLabel')}</label>
          <textarea id="note" name="note" rows={4} maxLength={4000} className="ir-field" />
        </div>
      </section>

      {fileProblem ? (
        <p role="alert" className="ir-notice border-danger bg-danger-tint text-ink">
          {fileProblem === 'count'
            ? t('error.fileCount', { max: MAX_FILES })
            : t('error.fileTotal', { mb: MAX_TOTAL_FILE_BYTES / (1024 * 1024) })}
        </p>
      ) : null}

      {state.error ? (
        <p role="alert" className="ir-notice border-danger bg-danger-tint text-ink">
          {t(`error.${state.error}`)}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <SubmitButton label={t('submit')} disabled={fileProblem !== null} />
        <p className="text-center text-[0.875rem] text-ink-soft">{t('submitHint')}</p>
      </div>
    </form>
  )
}

function SectionHeading({ id, mark, title }: { id: string; mark: string; title: string }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2.5 text-[1.125rem] font-bold">
      <span
        aria-hidden="true"
        className="rounded-field border border-line px-1.5 py-0.5 text-[0.75rem] font-bold text-brand"
      >
        {mark}
      </span>
      {title}
    </h2>
  )
}

function Answer({ id, label, rows }: { id: string; label: string; rows: number }) {
  const fieldId = `answer-${id}`
  return (
    <div className="mt-3">
      <label className="ir-label text-ink-soft" htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        name={`answer:${id}`}
        rows={rows}
        maxLength={4000}
        className="ir-field"
      />
    </div>
  )
}

/**
 * Shows the accountant what they have picked, because a bare file input on a
 * phone says "6 files" and nothing about which six. The list is display only;
 * the input itself is what submits.
 */
function FileField({ label, hint, onProblem }: {
  label: string
  hint: string
  onProblem: (problem: 'count' | 'size' | null) => void
}) {
  const id = useId()
  const [names, setNames] = useState<string[]>([])

  return (
    <div>
      <label className="ir-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        name="files"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="ir-field py-2.5 file:mr-3 file:rounded-field file:border-0 file:bg-brand-tint file:px-3 file:py-1.5 file:text-[0.9375rem] file:font-medium file:text-ink"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])]
          setNames(picked.map((f) => f.name))
          const total = picked.reduce((sum, f) => sum + f.size, 0)
          const oversize = picked.some((f) => f.size > MAX_FILE_BYTES)
          onProblem(
            picked.length > MAX_FILES ? 'count'
              : total > MAX_TOTAL_FILE_BYTES || oversize ? 'size'
                : null)
        }}
      />
      <p className="ir-hint">{hint}</p>
      {names.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-[0.875rem] text-ink-soft">
          {names.map((name) => <li key={name}>{name}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The honeypot half of the bot protection (the other halves are the signed
 * stamp and the rate limiter, both in the action).
 *
 * `aria-hidden` and `tabIndex={-1}` keep it away from assistive technology and
 * off the keyboard path, so it is invisible to a person using a screen reader
 * as well as to one using their eyes. It is positioned off-screen rather than
 * `display: none`, because the simpler bots skip hidden fields and fill the
 * rest.
 */
function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
      <label htmlFor="company_website">Company website</label>
      <input
        id="company_website"
        name="company_website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  )
}

function Thanks() {
  const t = useTranslations('accountant')
  return (
    <div role="status" className="ir-card mt-8 p-6">
      <h2 className="text-[1.25rem] font-bold">{t('doneTitle')}</h2>
      <p className="mt-2 text-ink-soft">{t('doneBody')}</p>
    </div>
  )
}
