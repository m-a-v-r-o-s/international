'use client'

import { useActionState, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { SubmitButton } from '@/components/SubmitButton'
import { signContract, type ContractState } from './contract-actions'

/**
 * R4 step 5 — the guest signs on screen (docs/01-DECISIONS.md §16).
 *
 * TWO EQUAL PATHS, not one path and a fallback. Drawing on a canvas is
 * inherently pointer-only: there is no keyboard gesture for a signature, and
 * pretending otherwise with a "type your name to sign" box would quietly
 * change what the guest is agreeing to. So the second path is the one the
 * business already has — the guest signs a paper copy and the rep photographs
 * it with a plain file input — and it produces exactly the same stored image
 * and exactly the same contract. docs/02-ARCHITECTURE.md asks the signature
 * flow for an accessible non-visual path; this is it, and it is a real one.
 *
 * The canvas itself is drawn at device pixel ratio so a signature captured on
 * a phone is not a blurred smear when it is embedded in an A4 page, and it is
 * exported as a PNG data URL that the action re-validates by content.
 */
export function SignaturePad({
  bookingId, defaultSignerName,
}: {
  bookingId: string
  defaultSignerName: string
}) {
  const t = useTranslations('contractStep')
  const tc = useTranslations('common')
  const te = useTranslations('errors')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dataRef = useRef<HTMLInputElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [state, formAction] = useActionState<ContractState, FormData>(signContract, undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [])

  const at = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const { x, y } = at(event)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = at(event)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas && dataRef.current) dataRef.current.value = canvas.toDataURL('image/png')
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (dataRef.current) dataRef.current.value = ''
    setHasInk(false)
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="signature_data" ref={dataRef} />

      {state?.error ? (
        <p className="ir-notice border-danger bg-danger-tint text-danger" role="alert">
          {te(state.error)}
        </p>
      ) : null}

      <div>
        <label className="ir-label" htmlFor="signer_name">{t('signerName')}</label>
        <input
          id="signer_name"
          name="signer_name"
          className="ir-field"
          defaultValue={defaultSignerName}
          maxLength={160}
          required
          autoComplete="off"
        />
        <p className="ir-hint">{t('signerNameHint')}</p>
      </div>

      <div>
        <p className="ir-label" id="signature_label">{t('drawLabel')}</p>
        <canvas
          ref={canvasRef}
          aria-labelledby="signature_label"
          aria-describedby="signature_hint"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          className="h-40 w-full touch-none rounded-field border border-line-strong bg-surface"
        />
        <p className="ir-hint" id="signature_hint">{t('drawHint')}</p>
        <button
          type="button"
          onClick={clear}
          className="min-h-11 text-[0.9375rem] font-medium text-brand underline underline-offset-2"
        >
          {t('clearSignature')}
        </button>
        {hasInk ? (
          <p className="text-[0.875rem] text-ok" role="status">{t('signatureCaptured')}</p>
        ) : null}
      </div>

      <div className="border-t border-line pt-4">
        <label className="ir-label" htmlFor="signature_photo">{t('photoLabel')}</label>
        <input
          id="signature_photo"
          name="signature_photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="ir-field file:mr-3 file:min-h-9 file:rounded-field file:border-0 file:bg-brand-tint file:px-3 file:font-medium file:text-ink"
          aria-describedby="signature_photo_hint"
        />
        <p className="ir-hint" id="signature_photo_hint">{t('photoHint')}</p>
      </div>

      <SubmitButton label={t('signAction')} />
      <p className="ir-hint">{tc('required')}</p>
    </form>
  )
}
