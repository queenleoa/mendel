// Run once to create the schema in your Neon database.
//   npm run db:setup
//
// Reads DATABASE_URL from next-app/.env.local or next-app/.env.
import { Pool } from '@neondatabase/serverless'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')

function loadEnvFile(filename) {
  const path = join(projectRoot, filename)
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // First file wins (matches Next.js precedence).
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

// Same precedence Next.js uses: .env.local overrides .env.
loadEnvFile('.env.local')
loadEnvFile('.env')

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL not set. Add it to next-app/.env.local or .env, e.g.:\n' +
      "  DATABASE_URL='postgresql://user:pw@host/dbname?sslmode=require'",
  )
  process.exit(1)
}

const sqlPath = join(here, 'schema.sql')
const sql = readFileSync(sqlPath, 'utf8')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean)

try {
  for (const stmt of statements) {
    process.stdout.write(
      stmt.slice(0, 80) + (stmt.length > 80 ? '…' : '') + ' … ',
    )
    await pool.query(stmt + ';')
    console.log('OK')
  }
  console.log('Schema ready.')
} finally {
  await pool.end()
}
