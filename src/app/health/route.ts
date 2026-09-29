import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * For the external uptime monitor (docs/07-SEASON-ROUTINE.md). Public, and
 * says nothing but up or down: 200 when the app can read the database, 503
 * when it cannot, so a paused or unreachable Supabase pages someone just like
 * a dead server does. `/login` alone would stay 200 through a database outage.
 *
 * The answer is kept for 30 seconds so hammering this URL costs at most two
 * database reads a minute.
 */
let last: { ok: boolean; at: number } | null = null

export async function GET() {
  if (!last || Date.now() - last.at > 30_000) {
    const { error } = await supabaseAdmin().from('app_settings').select('id').eq('id', 1).maybeSingle()
    last = { ok: !error, at: Date.now() }
  }
  return new NextResponse(last.ok ? 'ok' : 'database unreachable', {
    status: last.ok ? 200 : 503,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store, max-age=0' },
  })
}
