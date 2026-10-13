import fs from 'fs'
import pg from 'pg'
const m = fs.readFileSync('.env').toString().match(/DATABASE_URL=(.*)/)
const pool = new pg.Pool({ connectionString: m[1], max: 2, idleTimeoutMillis: 8000, connectionTimeoutMillis: 12000 })
const q = (sql) => pool.query(sql)
const main = async () => {
  try {
    const tabs = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`)
    console.log('TABLES (public):')
    tabs.rows.forEach(r => console.log('  ', r.table_name))
    const cols = await q(`SELECT table_name,column_name,data_type,column_default,is_nullable,character_maximum_length FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)
    const byT = new Map()
    cols.rows.forEach(c => {
      if (!byT.has(c.table_name)) byT.set(c.table_name, [])
      byT.get(c.table_name).push(c)
    })
    for (const [tname, colsFor] of byT.entries()) {
      console.log('\n' + tname + ':')
      colsFor.forEach(c => {
        const def = c.column_default, data = c.data_type, n = c.is_nullable, len = c.character_maximum_length
        const parts = [c.column_name.padEnd(30), data + (len ? `(${len})` : '')]
        if (def) parts.push('default=' + String(def).slice(0, 60))
        if (n === 'NO') parts.push('NOT NULL')
        console.log('   ', parts.join(' | '))
      })
    }
    // foreign keys
    const fks = await q(`SELECT tc.table_name, kcu.column_name, ccu.table_schema AS fk_schema, ccu.table_name AS fk_table, ccu.column_name AS fk_column FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public' ORDER BY tc.table_name, kcu.ordinal_position`)
    console.log('\nFOREIGN KEYS (public):')
    fks.rows.forEach(f => console.log(`   ${f.table_name}.${f.column_name} -> ${f.fk_table}.${f.fk_column}`))
    await pool.end()
  } catch (e) { console.error('ERR', e.message); process.exit(1) }
}
main()
