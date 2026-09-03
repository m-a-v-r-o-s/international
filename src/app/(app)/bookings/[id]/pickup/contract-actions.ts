'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUnlocked } from '@/lib/auth/session'
import { supabaseServer } from '@/lib/supabase/server'
import { errorKey, type ErrorKey } from '@/lib/errors'
import { loadContractSource } from '@/lib/contract/load'
import { renderContractPdf } from '@/lib/contract/render'
import { uploadBookingFile, readBookingFile, MAX_UPLOAD_BYTES } from '@/lib/storage/booking-files'
import { sniffType, IMAGE_TYPES } from '@/lib/storage/sniff'
import { mailConfigured, send } from '@/lib/email/mailer'

export type ContractState = {
  error?: ErrorKey
  saved?: boolean
  /** The copy was recorded against the contract but no mail was sent. */
  mailPending?: 'not_configured' | 'failed'
  /**
   * What became of the ledger tick box beside the signature
   * (docs/01-DECISIONS.md §25a). `noPhone` is not a failure: the guest agreed,
   * but the number on the booking could not be resolved to a country, so there
   * is nothing to key a ledger entry on and the screen says so rather than
   * silently doing nothing.
   */
  ledger?: 'kept' | 'declined' | 'noPhone'
} | undefined

const uuidSchema = z.string().uuid()

/** A canvas signature arrives as a data URL; a photographed one as a file. */
const dataUrlSchema = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(2_000_000)

/**
 * R4 step 5 — the guest signs, and the agreement becomes a stored document
 * (docs/01-DECISIONS.md §16).
 *
 * The order is what makes this safe to re-run and hard to fake:
 *
 *   1. re-check that this session may see the booking at all (RLS answers);
 *   2. REFUSE if the company details or the terms are not filled in. This is
 *      the guard the whole A10 detour was for: an agreement printed off an
 *      empty app_settings.company is a DRAFT, and a draft must never become
 *      something a guest has signed;
 *   3. store the signature image, so the PDF embeds a file that exists;
 *   4. render the PDF with the signature in it;
 *   5. store the PDF;
 *   6. insert the `contracts` row, which is what makes any of it findable.
 *
 * `signed_at` and `version` are NOT sent — app.contracts_before_write() sets
 * both, because when a document was signed is a fact about the write and not a
 * client's opinion (supabase/migrations/20260830130000_contract_signing.sql).
 */
export async function signContract(_prev: ContractState, formData: FormData): Promise<ContractState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    signer_name: z.string().trim().min(1).max(160),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    signer_name: formData.get('signer_name'),
  })
  if (!parsed.success) return { error: 'IR104' }
  const { booking_id, signer_name } = parsed.data

  // The ledger consent is read as its OWN field, from its OWN tick box, and it
  // is unchecked by default. That is not a UI preference — it is the legal
  // basis (docs/01-DECISIONS.md §25a). Consent that is bundled into an
  // agreement the guest has to sign in order to get the car is not freely
  // given (GDPR Art. 7(4)), so it is asked separately, beside the signature,
  // and signing with the box untouched keeps them out of the ledger.
  const ledgerConsent = formData.get('ledger_consent') === 'on'

  const signature = await signatureBytes(formData)
  if ('error' in signature) return { error: signature.error }

  const supabase = await supabaseServer()

  const source = await loadContractSource(supabase, booking_id)
  if (!source) return { error: 'forbidden' }
  if (!source.readiness.ready) return { error: 'companyMissing' }
  if (source.data.drivers.length === 0) return { error: 'IR121' }

  // A deterministic-per-attempt name: a re-signature is a new version, a new
  // file and a new row, and the bucket refuses to overwrite either of the
  // previous ones (booking_files_update excludes `signature` and `contract`).
  const stamp = `${Date.now().toString(36)}`

  const signatureUpload = await uploadBookingFile(supabase, {
    bookingId: booking_id,
    kind: 'signature',
    basename: `sig-${stamp}`,
    bytes: signature.bytes,
    accept: ['image/png', 'image/jpeg', 'image/webp'],
  })
  if (!signatureUpload.ok) return { error: signatureUpload.reason }

  const signedAt = new Date().toISOString()
  let pdf: Uint8Array
  try {
    pdf = await renderContractPdf({
      ...source.data,
      signature: signature.bytes,
      signerName: signer_name,
      signedAt,
    })
  } catch {
    return { error: 'contractFailed' }
  }

  const pdfUpload = await uploadBookingFile(supabase, {
    bookingId: booking_id,
    kind: 'contract',
    basename: `agreement-${stamp}`,
    bytes: pdf,
    accept: ['application/pdf'],
    contentType: 'application/pdf',
  })
  if (!pdfUpload.ok) return { error: pdfUpload.reason }

  const { error } = await supabase.from('contracts').insert({
    booking_id,
    pdf_path: pdfUpload.path,
    signature_path: signatureUpload.path,
    signer_name,
  })
  if (error) return { error: errorKey(error) }

  // Last, and never a reason to fail a signature. The agreement is the thing
  // that had to happen; the ledger is a convenience the guest agreed to or did
  // not. A re-signature re-reads the box, so un-ticking it on a second signing
  // is a withdrawal and really deletes (public.withdraw_customer_consent →
  // the orphan trigger).
  let ledger: 'kept' | 'declined' | 'noPhone' = 'declined'
  if (ledgerConsent) {
    const { data: customerId } = await supabase.rpc('record_customer_consent', {
      p_booking_id: booking_id,
    })
    ledger = customerId ? 'kept' : 'noPhone'
  } else {
    await supabase.rpc('withdraw_customer_consent', { p_booking_id: booking_id })
  }

  revalidatePath(`/bookings/${booking_id}/pickup`)
  revalidatePath(`/bookings/${booking_id}`)
  return { saved: true, ledger }
}

/**
 * R4 step 6 — the optional copy.
 *
 * §9 puts the guest's email here and nowhere else: "optional, asked only at the
 * signing step to send the contract copy". §16 adds the skip, which is a link
 * to the next step rather than an action — declining to give an address is not
 * an event worth recording.
 *
 * When SMTP is not configured (it is not: the client has not supplied a
 * domain), the address is still recorded against the contract and the booking,
 * `emailed_at` stays null, and the screen says the copy has not gone out. A
 * spinner that resolved to a lie would be worse than the truth.
 */
export async function emailContract(_prev: ContractState, formData: FormData): Promise<ContractState> {
  await requireUnlocked()

  const parsed = z.object({
    booking_id: uuidSchema,
    contract_id: uuidSchema,
    email: z.string().trim().email().max(254),
  }).safeParse({
    booking_id: formData.get('booking_id'),
    contract_id: formData.get('contract_id'),
    email: formData.get('email'),
  })
  if (!parsed.success) return { error: 'IR104' }
  const { booking_id, contract_id, email } = parsed.data

  const supabase = await supabaseServer()

  const { data: contract } = await supabase.from('contracts')
    .select('id, booking_id, pdf_path, signer_name')
    .eq('id', contract_id).eq('booking_id', booking_id).maybeSingle()
  if (!contract) return { error: 'IR112' }

  const { data: booking } = await supabase.from('bookings')
    .select('id, ref').eq('id', booking_id).maybeSingle()
  if (!booking) return { error: 'forbidden' }

  let result: Awaited<ReturnType<typeof send>> = { sent: false, reason: 'not_configured' }

  if (mailConfigured()) {
    const pdf = await readBookingFile(supabase, contract.pdf_path)
    result = pdf
      ? await send({
          to: email,
          // Bilingual, like the document itself (§24).
          subject: `Σύμβαση ενοικίασης / Rental agreement: ${booking.ref}`,
          text: [
            `Συνημμένα θα βρείτε τη σύμβαση ενοικίασης ${booking.ref}.`,
            '',
            `Attached is your rental agreement ${booking.ref}.`,
          ].join('\n'),
          attachments: [{
            filename: `${booking.ref}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          }],
        })
      : { sent: false, reason: 'failed' }
  }

  // Recorded either way. `emailed_to` and `emailed_at` are the only two
  // columns any client may move on a contract, and the guard trigger restores
  // the rest — the signed document itself is not editable by anybody.
  const { error } = await supabase.from('contracts').update({
    emailed_to: email,
    emailed_at: result.sent ? new Date().toISOString() : null,
  }).eq('id', contract_id)
  if (error) return { error: errorKey(error) }

  // §9 keeps the address on the booking too, so a later re-send does not have
  // to ask the guest for it again.
  await supabase.from('bookings').update({ cust_email: email }).eq('id', booking_id)

  revalidatePath(`/bookings/${booking_id}/pickup`)
  return result.sent ? { saved: true } : { saved: true, mailPending: result.reason }
}

/**
 * The signature, from either path.
 *
 * The canvas is the ordinary one. The file input beside it is the accessible
 * one and is not a lesser version of it: a guest who cannot sign on a phone
 * screen signs on paper and the rep photographs it, which is how the business
 * already works and produces exactly the same stored image. Both are validated
 * by CONTENT, not by what the browser said they were.
 */
async function signatureBytes(
  formData: FormData,
): Promise<{ bytes: Uint8Array } | { error: ErrorKey }> {
  const photo = formData.get('signature_photo')
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_UPLOAD_BYTES) return { error: 'fileTooLarge' }
    const bytes = new Uint8Array(await photo.arrayBuffer())
    const type = sniffType(bytes)
    if (!type || !IMAGE_TYPES.includes(type)) return { error: 'fileType' }
    return { bytes }
  }

  const drawn = dataUrlSchema.safeParse(formData.get('signature_data'))
  if (!drawn.success) return { error: 'signatureMissing' }

  const bytes = new Uint8Array(Buffer.from(drawn.data.split(',')[1] ?? '', 'base64'))
  // The data URL claimed PNG; the bytes have to agree, and an empty canvas
  // that produced a few bytes of nothing is not a signature.
  if (sniffType(bytes) !== 'image/png' || bytes.byteLength < 200) {
    return { error: 'signatureMissing' }
  }
  return { bytes }
}
