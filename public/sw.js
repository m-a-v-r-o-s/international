/*
 * The service worker, and nothing more than it has to be.
 *
 * docs/01-DECISIONS.md §22 asks for push notifications; §23 says the app is
 * online-only with no offline booking creation. So this worker does NOT cache,
 * does not intercept fetches and has no install-time asset list. A worker that
 * served pages from a cache would be an offline mode nobody asked for, and the
 * first thing it would do wrong is show a rep a stale availability screen.
 *
 * It handles exactly two events: a push arriving, and somebody tapping it.
 *
 * Every user-facing string arrives IN the push payload, already translated by
 * the sender from messages/el.json or messages/en.json according to that
 * person's own profiles.lang. Nothing is hard-coded here — this file is
 * outside next-intl's reach, and a English-only worker would be a hard-coded
 * user-facing string in the one place nobody would think to look.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    return // not ours; showing "undefined" to a rep is worse than showing nothing
  }

  const title = typeof payload.title === 'string' ? payload.title : ''
  if (!title) return

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      lang: typeof payload.lang === 'string' ? payload.lang : 'el',
      // One notification per kind, replaced rather than stacked: a rep who
      // leaves their phone on the desk should find this morning's summary, not
      // four of them.
      tag: typeof payload.tag === 'string' ? payload.tag : 'ir',
      renotify: true,
      data: { url: typeof payload.url === 'string' ? payload.url : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  // Same-origin only. The URL comes from a payload, and a payload is data.
  if (target.origin !== self.location.origin) return

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(target.href)
        return
      }
    }
    await self.clients.openWindow(target.href)
  })())
})
