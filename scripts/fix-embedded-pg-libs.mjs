// The @embedded-postgres/* packages ship versioned shared objects (libpq.so.5.18)
// without the SONAME symlinks (libpq.so.5) the binaries actually dlopen. Some
// platform packages create them in their own postinstall, some do not. This is
// idempotent and silent when there is nothing to do — it only ever affects the
// local test harness, never the deployed app.
import { readdirSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const roots = [
  'node_modules/@embedded-postgres/linux-x64/native/lib',
  'node_modules/@embedded-postgres/linux-arm64/native/lib',
  'node_modules/@embedded-postgres/darwin-x64/native/lib',
  'node_modules/@embedded-postgres/darwin-arm64/native/lib',
]

for (const root of roots) {
  if (!existsSync(root)) continue
  for (const file of readdirSync(root)) {
    const m = /^(lib[^.]+\.so\.\d+)\.\d+/.exec(file)
    if (!m) continue
    const link = join(root, m[1])
    if (existsSync(link)) continue
    try {
      symlinkSync(file, link)
    } catch {
      /* a parallel install won the race; nothing to do */
    }
  }
}
