import { NextResponse } from 'next/server'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { loadContractSource } from '@/lib/contract/load'
import { renderContractPdf } from '@/lib/contract/render'
import { allow } from '@/lib/rate-limit'

/**
 * The unsigned agreement, rendered on demand so the rep can show the guest
 * what they are about to sign (docs/04-SCREENS.md R4.5, "bilingual PDF
 * preview").
 *
 * Nothing is stored. This is a preview and only a preview: the signed document
 * is produced once, at the moment of signing, and lives in the private bucket
 * from then on — reached through a short-lived signed URL like every other
 * file, never through this route.
 *
 * Authorisation is the booking's own. loadContractSource() reads through the
 * caller's session, so a rep asking for a booking that is neither theirs nor
 * their hotel's gets nothing back and this returns 404 — the same answer as a
 * booking that does not exist, which is the answer that leaks least.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const staff = await requireUnlocked()
  const { id } = await params

  // Rendering a PDF is the most expensive thing a signed-in session can ask
  // this server to do, so it is capped like the OCR call is.
  if (!(await allow(`contract-preview:${staff.id}`, 60, 300))) {
    return new NextResponse('Too many requests', { status: 429 })
  }

  const supabase = await supabaseServer()
  const source = await loadContractSource(supabase, id)
  if (!source) return new NextResponse('Not found', { status: 404 })

  const pdf = await renderContractPdf(source.data)

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // Inline so it opens in the phone's viewer rather than landing in
      // Downloads; never cached, because it is a live view of a booking that
      // is still being edited a step at a time.
      'Content-Disposition': `inline; filename="${source.data.ref}-preview.pdf"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
