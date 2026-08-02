import { useState } from 'react'
import { api } from '../api/client.js'
import { formatBytes } from '../lib/filePeek.js'
import { num } from '../lib/format.js'

// 신청서에 딸려 온 파일.
//
// 이름만 보여 주고 열어 볼 수 없으면, 담당자는 결국 "그 파일 메일로 보내
// 주세요"를 하게 된다. 파일을 받아 두고 못 보게 하는 것은 안 받는 것보다 나쁘다.
//
// 내려받기 전에 앞부분을 표로 볼 수 있게 했다. 검토할 때 알고 싶은 것은
// 대개 "컬럼이 뭐가 있나" 하나뿐이고, 그걸 보려고 파일을 내려받아 엑셀을
// 여는 것은 과하다.
export default function FileList({ applicationId, files, compact = false }) {
  const [open, setOpen] = useState(null)
  const [preview, setPreview] = useState({})
  const [loading, setLoading] = useState(null)

  if (!files || files.length === 0) return null

  async function look(file) {
    if (open === file.id) {
      setOpen(null)
      return
    }
    setOpen(file.id)
    if (preview[file.id]) return

    setLoading(file.id)
    try {
      const r = await api.get(`/applications/${applicationId}/files/${file.id}?preview=1`)
      setPreview((p) => ({ ...p, [file.id]: r }))
    } catch (err) {
      setPreview((p) => ({ ...p, [file.id]: { note: err.message } }))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="file-list">
      {files.map((f) => (
        <div key={f.id} className="file-item">
          <div className="file-row">
            <span className="file-icon" aria-hidden="true">
              {iconFor(f.name)}
            </span>
            <span className="file-name">{f.name}</span>
            <span className="card-note">{formatBytes(f.byte_size)}</span>
            <span className="spacer" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => look(f)}>
              {open === f.id ? '접기' : '들여다보기'}
            </button>
            <a
              className="btn-ghost btn-sm"
              href={`/api/applications/${applicationId}/files/${f.id}`}
              download={f.name}
            >
              내려받기
            </a>
          </div>

          {open === f.id && (
            <div className="file-preview">
              {loading === f.id && <div className="card-note">읽는 중…</div>}
              {preview[f.id]?.note && <div className="card-note">{preview[f.id].note}</div>}
              {preview[f.id]?.sheets?.map((s, i) => (
                <div key={i} className="file-sheet">
                  <div className="row" style={{ marginBottom: 6 }}>
                    {s.sheetName && <span className="badge badge-neutral">{s.sheetName}</span>}
                    {/* 인코딩 이름으로 색을 정하면 안 된다.
                        CP949를 노랗게 칠하고 있었는데, CP949는 제대로 읽어
                        낸 것이고 오히려 판별을 못 한 쪽이 위험하다. 색 약속이
                        신청 화면과 정반대였다. 판별에 확신이 있었는지로 칠한다. */}
                    {s.encoding && (
                      <span
                        className={`badge ${s.encodingConfident === false ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {s.encoding}
                      </span>
                    )}
                    <span className="card-note">
                      머리글 {s.headerRowNo}번째 줄 · 컬럼 {s.header.length}개 ·{' '}
                      {num(s.totalRows)}줄
                    </span>
                  </div>

                  {s.encodingConfident === false ? (
                    <p className="card-note file-note">
                      글자 코드를 확실히 알아내지 못했습니다. 아래 미리보기에서 한글이 깨져 보이면
                      그 파일은 저희가 제대로 못 읽은 것입니다 — 담당자에게 알려주세요.
                    </p>
                  ) : (
                    s.encoding === 'CP949' && (
                      <p className="card-note file-note">
                        UTF-8이 아니라 CP949로 저장된 파일입니다. 엑셀에서 그냥 열면 한글이 깨질 수
                        있는데, 여기서는 제대로 읽었습니다.
                      </p>
                    )
                  )}

                  <div className="table-wrap" style={{ maxHeight: compact ? 200 : 280 }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="num">줄</th>
                          {s.header.map((h, hi) => (
                            <th key={hi}>{h || <span className="card-note">(빈 칸)</span>}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.rows.map((r) => (
                          <tr key={r.rowNo}>
                            <td className="num card-note">{r.rowNo}</td>
                            {s.header.map((_, ci) => (
                              <td key={ci}>{fmt(r.cells[ci])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {s.totalRows > s.rows.length && (
                    <p className="card-note" style={{ marginTop: 6 }}>
                      앞 {s.rows.length}줄만 보여드립니다. 전체 {num(s.totalRows)}줄은 내려받아
                      확인하세요.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function fmt(v) {
  if (v == null || v === '') return <span className="card-note">—</span>
  return String(v)
}

function iconFor(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase()
  if (['xlsx', 'xls'].includes(ext)) return '▦'
  if (['csv', 'tsv', 'txt'].includes(ext)) return '≡'
  if (ext === 'pdf') return '▤'
  if (['png', 'jpg', 'jpeg'].includes(ext)) return '▣'
  return '▪'
}
