/**
 * The evening outage sheet, for a scheduler (src/lib/outage-sheet.ts).
 *
 *   npm run outage-sheet
 *
 * Off until OUTAGE_SHEET_TO is set: without it this logs and exits cleanly, so
 * the Railway service can exist before the owner wants the mail. With it set
 * but no SMTP_* configured it fails, because a sheet that silently never
 * arrives is worse than none. A night with nothing in the next 48 hours sends
 * nothing.
 */
import { loadOutageSheet } from '../src/lib/outage-sheet'
import { mailConfigured, send } from '../src/lib/email/mailer'

const to = process.env.OUTAGE_SHEET_TO
if (!to) {
  console.log('outage-sheet: OUTAGE_SHEET_TO not set, off')
  process.exit(0)
}
if (!mailConfigured()) {
  console.error('outage-sheet: SMTP_* not configured, cannot send')
  process.exit(1)
}

const sheet = await loadOutageSheet()
if (!sheet) {
  console.log('outage-sheet: nothing in the next 48 hours, not sent')
  process.exit(0)
}

const result = await send({
  to,
  subject: sheet.subject,
  text: sheet.text,
  html: sheet.html,
  attachments: [{ filename: sheet.filename, content: new TextEncoder().encode(sheet.csv), contentType: 'text/csv; charset=utf-8' }],
})
if (!result.sent) {
  console.error(`outage-sheet: send failed (${result.reason})`)
  process.exit(1)
}
console.log('outage-sheet: sent')
