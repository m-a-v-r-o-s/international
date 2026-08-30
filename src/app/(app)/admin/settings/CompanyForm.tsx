'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/Field'
import { SubmitButton } from '@/components/SubmitButton'
import type { Company } from '@/lib/contract/company'
import { saveCompanySettings, type SettingsState } from './actions'

/**
 * The boss types the company's legal identity and the agreement's terms here,
 * once, and every contract the app generates from then on is printed from it.
 *
 * The terms boxes are deliberately plain textareas taking the text verbatim.
 * The client's own paper agreement is what goes in them, in each language, and
 * the app has no business reformatting, summarising or "improving" a legal
 * document on its way to a guest's signature.
 */
export function CompanyForm({ company }: { company: Company }) {
  const t = useTranslations('adminSettings')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const [state, formAction] = useActionState<SettingsState, FormData>(
    saveCompanySettings, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}
      {state?.saved ? (
        <p className="ir-notice border-ok bg-ok-tint text-ok" role="status">{t('saved')}</p>
      ) : null}

      <section className="ir-card flex flex-col gap-4 p-4">
        <h2 className="text-[1.0625rem] font-semibold">{t('legalTitle')}</h2>

        <Field
          id="legal_name" name="legal_name" label={t('legalName')}
          defaultValue={company.legal_name} maxLength={200} autoComplete="off"
          hint={t('legalNameHint')}
        />

        <div>
          <label className="ir-label" htmlFor="address">{t('address')}</label>
          <textarea
            id="address" name="address" className="ir-field" rows={3} maxLength={400}
            defaultValue={company.address}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="vat_number" name="vat_number" label={t('vatNumber')}
            defaultValue={company.vat_number} maxLength={40} autoComplete="off"
            hint={t('vatNumberHint')}
          />
          <Field
            id="phone" name="phone" label={t('phone')}
            defaultValue={company.phone} maxLength={40} autoComplete="off"
          />
          <Field
            id="email" name="email" type="email" label={t('email')}
            defaultValue={company.email} maxLength={254} autoComplete="off"
            hint={t('optional')}
          />
        </div>
      </section>

      <section className="ir-card flex flex-col gap-4 p-4">
        <h2 className="text-[1.0625rem] font-semibold">{t('insuranceTitle')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="insurer" name="insurer" label={t('insurer')}
            defaultValue={company.insurer} maxLength={200} autoComplete="off"
          />
          <Field
            id="insurance_policy" name="insurance_policy" label={t('insurancePolicy')}
            defaultValue={company.insurance_policy} maxLength={120} autoComplete="off"
            hint={t('optional')}
          />
        </div>
      </section>

      <section className="ir-card flex flex-col gap-4 p-4">
        <h2 className="text-[1.0625rem] font-semibold">{t('termsTitle')}</h2>
        <p className="text-[0.9375rem] text-ink-soft">{t('termsIntro')}</p>

        <div>
          <label className="ir-label" htmlFor="terms_el">{t('termsEl')}</label>
          <textarea
            id="terms_el" name="terms_el" className="ir-field font-mono text-[0.875rem]"
            rows={12} maxLength={20000} defaultValue={company.terms_el}
            aria-describedby="terms_el_hint" spellCheck={false}
          />
          <p className="ir-hint" id="terms_el_hint">{t('termsHint')}</p>
        </div>

        <div>
          <label className="ir-label" htmlFor="terms_en">{t('termsEn')}</label>
          <textarea
            id="terms_en" name="terms_en" className="ir-field font-mono text-[0.875rem]"
            rows={12} maxLength={20000} defaultValue={company.terms_en}
            aria-describedby="terms_en_hint" spellCheck={false}
          />
          <p className="ir-hint" id="terms_en_hint">{t('termsHint')}</p>
        </div>
      </section>

      <SubmitButton label={tc('save')} />
    </form>
  )
}
