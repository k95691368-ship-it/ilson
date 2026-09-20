// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url)
const files = readdirSync(migrationDirectory).filter(file => /^\d{4}_.+\.sql$/.test(file)).sort()
const readMigration = file => readFileSync(new URL(file, migrationDirectory), 'utf8')
const accessMigration = readMigration('0006_access_scope.sql')

async function baseline() {
  const pg = new PGlite()
  try {
    await pg.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE migration_owner LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOBYPASSRLS;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO migration_owner;
    `)
    const database = (await pg.query('SELECT current_database() AS name')).rows[0].name
    await pg.exec(`GRANT CREATE ON DATABASE "${database.replaceAll('"', '""')}" TO migration_owner; SET ROLE migration_owner;`)
    for (const file of files.filter(file => file < '0006_')) await pg.exec(readMigration(file))
    return pg
  } catch (error) {
    await pg.close()
    throw error
  }
}

async function roleState(pg) {
  return (await pg.query(`SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,
    has_schema_privilege(rolname,'public','CREATE') AS schema_create
    FROM pg_roles WHERE rolname='ilson_scoped_executor'`)).rows[0]
}

describe('access migration under a non-superuser migration owner', () => {
  it('applies the complete migration chain without retaining CREATE or bypassing RLS', async () => {
    const pg = await baseline()
    try {
      expect((await pg.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper).toBe(false)
      for (const file of files.filter(file => file >= '0006_')) await pg.exec(readMigration(file))
      expect(await roleState(pg)).toEqual({ rolcanlogin: false, rolinherit: false, rolsuper: false,
        rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, schema_create: false })
      expect((await pg.query(`SELECT count(*)::int AS count FROM pg_proc
        WHERE oid IN ('public.ilson_actor_query(text,text)'::regprocedure,'public.ilson_actor_batch(text,jsonb)'::regprocedure,
          'public.ilson_actor_receipt(text,text,text)'::regprocedure,'public.ilson_actor_commit(text,text,text,jsonb,jsonb,jsonb)'::regprocedure)
          AND proowner='ilson_scoped_executor'::regrole`)).rows[0].count).toBe(4)
      await pg.exec(`INSERT INTO public.override_actor(email,display_name,role) VALUES
        ('owner-a@test.invalid','A','reviewer'),('owner-b@test.invalid','B','reviewer');
        INSERT INTO public.application(id,ticket_no,dept,applicant_label,title,bottleneck,problem,owner_email) VALUES
        ('app-a','ticket-a','재무','A','A request','bottleneck','problem','owner-a@test.invalid'),
        ('app-b','ticket-b','재무','B','B request','bottleneck','problem','owner-b@test.invalid');
        RESET ROLE; SET ROLE service_role;`)
      const selected = (await pg.query('SELECT public.ilson_actor_query($1,$2) AS data',
        ['owner-a@test.invalid', 'SELECT id FROM public.application ORDER BY id'])).rows[0].data
      expect(selected.rows).toEqual([{ id: 'app-a' }])
      const changed = (await pg.query('SELECT public.ilson_actor_query($1,$2) AS data',
        ['owner-a@test.invalid', "UPDATE public.application SET title='forbidden' WHERE id='app-b'"])).rows[0].data
      expect(changed.rowCount).toBe(0)
      expect((await pg.query('SELECT public.ilson_readiness(NULL) AS data')).rows[0].data).toMatchObject({ migration: '0013', schemaReady: true })
      await pg.exec('RESET ROLE; SET ROLE anon')
      await expect(pg.query('SELECT public.ilson_actor_query($1,$2)',
        ['owner-a@test.invalid', 'SELECT id FROM public.application'])).rejects.toMatchObject({ code: '42501' })
      await expect(pg.query('SELECT * FROM public.application')).rejects.toMatchObject({ code: '42501' })
      await pg.exec('RESET ROLE; SET ROLE ilson_scoped_executor')
      await expect(pg.exec('CREATE TABLE public.runtime_must_not_create(id int)')).rejects.toMatchObject({ code: '42501' })
    } finally { await pg.close() }
  }, 60000)

  it('rolls back the temporary schema grant and partial migration after a late failure', async () => {
    const pg = await baseline()
    try {
      await pg.exec('CREATE ROLE ilson_scoped_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT ilson_scoped_executor TO migration_owner')
      expect((await roleState(pg)).schema_create).toBe(false)
      const ownershipTransfer = 'ALTER FUNCTION public.ilson_actor_query(text,text) OWNER TO ilson_scoped_executor;'
      expect(accessMigration).toContain(ownershipTransfer)
      // Simulate a failure after the temporary grant, without changing the SQL file.
      const failedMigration = accessMigration.replace(ownershipTransfer, () =>
        "DO $$ BEGIN RAISE EXCEPTION 'deliberate migration failure' USING ERRCODE='P0001'; END $$;\n" + ownershipTransfer)
      await expect(pg.exec(failedMigration)).rejects.toMatchObject({ code: 'P0001' })
      await pg.exec('ROLLBACK')
      expect((await roleState(pg)).schema_create).toBe(false)
      expect((await pg.query("SELECT to_regprocedure('public.ilson_actor_query(text,text)') AS procedure")).rows[0].procedure).toBeNull()
      expect((await pg.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='application' AND column_name='owner_email'")).rows[0].count).toBe(0)
      // The same safe pre-existing role also supports a clean retry.
      await pg.exec(accessMigration)
      expect((await roleState(pg)).schema_create).toBe(false)
    } finally { await pg.close() }
  }, 60000)

  it('rejects an existing bypass role instead of trusting or weakening it', async () => {
    const pg = await baseline()
    try {
      await pg.exec('RESET ROLE; CREATE ROLE ilson_scoped_executor NOLOGIN NOINHERIT BYPASSRLS; SET ROLE migration_owner')
      await expect(pg.exec(accessMigration)).rejects.toMatchObject({ code: '42501', message: 'Unsafe scoped executor role' })
      await pg.exec('ROLLBACK')
      expect((await roleState(pg)).schema_create).toBe(false)
      expect((await roleState(pg)).rolbypassrls).toBe(true)
      expect((await pg.query("SELECT to_regprocedure('public.ilson_actor_query(text,text)') AS procedure")).rows[0].procedure).toBeNull()
    } finally { await pg.close() }
  }, 60000)
})
