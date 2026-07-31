import fs from 'fs'
import { runPipeline } from '../shared/pipeline.js'
const p='public/samples/01_자사몰_주문내역_2026-06.csv'
const buf=fs.readFileSync(p)
const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)
const base=await runPipeline({files:[{name:'a.csv',buffer:ab}]})
console.log('원본      순매출', base.totals.all.net_revenue_krw, 'rows', base.rows.length, 'q', base.quarantine.length)
const txt=new TextDecoder().decode(buf)
const lines=txt.split(/\r?\n/)
lines[0]=lines[0].replace('할인액','할인금액')
const mutated=new TextEncoder().encode(lines.join('\n'))
const after=await runPipeline({files:[{name:'b.csv',buffer:mutated.buffer}]})
console.log('컬럼명변경 순매출', after.totals.all.net_revenue_krw, 'rows', after.rows.length, 'q', after.quarantine.length)
console.log('차이', after.totals.all.net_revenue_krw - base.totals.all.net_revenue_krw)
console.log('fileReport', JSON.stringify(after.files))
