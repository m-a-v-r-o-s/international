import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GlobalSetupContext } from 'vitest/node'
import { Client } from 'pg'
import { applySchema } from './helpers/schema'

const TEMPLATE_DB = 'ir_template'

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => res(port))
    })
  })
}

/**
 * The engine tests run against a real Postgres, not a mock: the exclusion
 * constraint, RLS, SECURITY DEFINER and two racing transactions are the things
 * under test, and none of them survive being simulated.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  // The bundled Postgres links against shared objects shipped beside it.
  const libDirs = [
    'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64',
  ].map((p) => resolve(`node_modules/@embedded-postgres/${p}/native/lib`))
  process.env.LD_LIBRARY_PATH = [...libDirs, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(':')

  const { default: EmbeddedPostgres } = await import('embedded-postgres')

  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), 'ir-pg-'))

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  })

  await pg.initialise()
  await pg.start()

  // One template database carries the shim plus every migration. Each test file
  // then clones it, so a file can commit freely without leaking into the next.
  const admin = new Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres',
  })
  await admin.connect()
  await admin.query(`create database ${TEMPLATE_DB}`)
  await admin.end()

  const template = new Client({
    host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: TEMPLATE_DB,
  })
  await template.connect()
  await applySchema(template)
  await template.end()

  provide('pgPort', port)
  provide('templateDb', TEMPLATE_DB)

  return async () => {
    await pg.stop()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgPort: number
    templateDb: string
  }
}
