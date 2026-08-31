import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LegalPage, type Section } from '@/components/LegalPage'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal')
  return { title: t('privacyTitle') }
}

/**
 * Order matters: `ledger` sits immediately after `retention` because it is the
 * exception to it. Everything else this app holds expires on a clock; the
 * customer ledger does not (docs/01-DECISIONS.md §25a), and a policy that
 * describes the automatic deletion of licence photographs without, in the very
 * next paragraph, saying that one category of data has no expiry at all would
 * be technically accurate and materially misleading.
 */
const SECTIONS: Section[] = [
  'intro', 'staff', 'guest', 'lawful', 'retention', 'ledger', 'security', 'rights', 'contact',
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
