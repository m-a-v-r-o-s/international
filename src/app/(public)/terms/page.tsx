import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LegalPage, type Section } from '@/components/LegalPage'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal')
  return { title: t('termsTitle') }
}

const SECTIONS: Section[] = ['scope', 'accounts', 'use', 'data', 'availability', 'changes']

export default async function TermsPage() {
  const t = await getTranslations('legal')
  return (
    <LegalPage
      title={t('termsTitle')}
      namespace="legal.terms"
      sections={SECTIONS}
      notice={t('draftNotice')}
    />
  )
}
