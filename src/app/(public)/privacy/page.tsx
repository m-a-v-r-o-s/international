import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LegalPage, type Section } from '@/components/LegalPage'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal')
  return { title: t('privacyTitle') }
}

const SECTIONS: Section[] = [
  'intro', 'staff', 'guest', 'lawful', 'retention', 'security', 'rights', 'contact',
]

export default async function PrivacyPage() {
  const t = await getTranslations('legal')
  return (
    <LegalPage
      title={t('privacyTitle')}
      namespace="legal.privacy"
      sections={SECTIONS}
      notice={t('draftNotice')}
    />
  )
}
