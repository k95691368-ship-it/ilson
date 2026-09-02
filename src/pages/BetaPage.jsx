import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DEPTS } from '../../shared/depts.js'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { num, ms, ago } from '../lib/format.js'
import { gradeAll } from '../../shared/grade.js'
import { passCaveat } from '../../shared/signoff.js'
import { PERIOD } from '../../shared/master.js'

// 시연 파일 다섯 장을 사이트에서 걷어냈다. 그래서 이 화면도 넣은 파일로
// 채점한다. 정답표가 함께 없어졌으므로 정답 대조 기준 셋은 「판정불가」로
// 나오고, 판정불가가 하나라도 남으면 이 회차는 통과가 아니다 —
// 안 본 것을 통과로 세면 이 게이트는 안 보고 열어 주는 문이 된다.


export default function BetaPage() {
  const { data: list } = useApi('/applications')
  // 할 일이 "어느 건이요"까지 실어 보낸다. 없으면 늘 첫 건 앞에 떨어지고,
  // 담당자는 칩을 하나씩 눌러 그 건을 찾아야 한다.
  const [params] = useSearchParams()
  const wanted = params.get('id')
  const [selectedId, setSelectedId] = useState(null)

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (selectedId || targets.length === 0) return
    // 주소로 온 건이 목록에 없으면(이미 처리했거나 상태가 바뀌었으면)
    // 첫 건으로 떨어진다 — 빈 화면을 보여 주는 것보다 낫다.
    const found = wanted && targets.find((a) => a.id === wanted)
    setSelectedId(found ? found.id : targets[0].id)
  }, [targets, selectedId, wanted])

  return (
    <div className="stack">
      <StageHeader stageKey="beta" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">시험할 과제가 없습니다</div>
          <div className="empty-sub">4단계에서 만든 것이 여기로 넘어옵니다.</div>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {targets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                aria-pressed={selectedId === a.id}
                onClick={() => setSelectedId(a.id)}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>
          {selectedId && <Beta key={selectedId} id={selectedId} />}
        </>
      )}
    </div>
  )
}

function Beta({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/beta`)
  const toast = useToast()
  const [testing, setTesting] = useState(false)
  const [progress, setProgress] = useState('')
  const fileInput = useRef(null)
  const [fixedWhat, setFixedWhat] = useState('')

  async function runTest(fileList) {
    const picked = [...(fileList ?? [])]
    if (picked.length === 0) return
    setTesting(true)
    try {
      setProgress('파일을 읽는 중…')
      const [files, aliasData] = await Promise.all([
        Promise.all(
          picked.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() }))
        ),
        api.get(`/applications/${id}/build`),
      ])
      // 정답표는 없다. 없으면 없는 대로 넘긴다 — 대조할 정답이 없는 기준은
      // 실패가 아니라 판정불가로 적힌다.
      const truth = undefined

      setProgress('합격 기준으로 채점하는 중…')
      const aliases = Object.fromEntries(
        (aliasData.aliases ?? []).map((a) => [a.external_code, a.canonical_code])
      )
      const graded = await gradeAll({
        criteria: data.criteria,
        files,
        aliases,
        truth,
        period: PERIOD,
      })

      setProgress('결과를 기록하는 중…')
      const saved = await api.post(`/applications/${id}/beta`, {
        kind: 'round',
        build_run_id: data.latestBuild?.id ?? null,
        graded: graded.graded,
        summary: graded.summary,
        fixed_what: fixedWhat.trim() || null,
      })

      if (saved.overall === '통과') toast.success('전부 통과했습니다.')
      else if (saved.overall === '차단') toast.error('필수 안전 기준이 깨져 배포가 막혔습니다.')
      else toast.info('일부 기준이 통과하지 못했습니다.')

      setFixedWhat('')
      await reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTesting(false)
      setProgress('')
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const latest = data.rounds[0] ?? null

  return (
    <div className="stack">
      {!data.canTest && (
        <div className="notice notice-warn">
          <div className="notice-title">아직 시험할 수 없습니다</div>
          <p>
            3단계에서 <strong>합격 기준을 확정</strong>해야 채점할 것이 생깁니다. 무엇을 통과로 볼지
            정하지 않고 시험하면, 결과에 맞춰 기준이 움직입니다.
          </p>
        </div>
      )}

      {latest && <VerdictBanner round={latest} signoff={data.signoff} />}

      {data.canTest && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              {latest ? `${latest.seq + 1}차 시험 돌리기` : '시험 돌리기'}
            </h2>
            <span className="card-note">
              합격 기준 {data.criteria.length}개로 채점합니다
            </span>
          </div>


          {latest && (
            <input
              value={fixedWhat}
              onChange={(e) => setFixedWhat(e.target.value)}
              placeholder="지난 회차 이후 무엇을 고쳤나요 (선택)"
              style={{ width: '100%', marginBottom: 10 }}
            />
          )}

          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={(e) => {
              runTest(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => fileInput.current?.click()}
            disabled={testing}
          >
            {testing ? progress || '채점하는 중…' : latest ? '파일 넣고 다시 시험하기' : '파일 넣고 시험 시작'}
          </button>
        </section>
      )}

      {data.latestResults.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">기준별 판정</h2>
            <span className="card-note">
              통과 {latest.passed} · 실패 {latest.failed} · 사람 확인 {latest.human_needed}
            </span>
          </div>
          <div className="stack-sm">
            {data.latestResults.map((r) => (
              <ResultCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      )}

      {data.rounds.length > 0 && <Rounds rounds={data.rounds} />}

      <Feedback data={data} id={id} toast={toast} onDone={reload} />
    </div>
  )
}

function VerdictBanner({ round, signoff }) {
  // 통과를 말할 때 무엇이 없는 통과인지 같이 적는다.
  //
  // 서명 없는 통과를 그냥 "통과"라고 적으면, 나중에 부서가 "그런 기준
  // 합의한 적 없다"고 할 때 이쪽에 근거가 없다. 통과 자체를 막지는
  // 않는다 — 막으면 부서가 답을 안 줄 때 아무것도 못 하게 된다.
  const caveat = passCaveat(signoff)

  if (round.overall === '통과') {
    return (
      <div className="verdict verdict-passed">
        <div className="verdict-head">{round.seq}차 — 통과</div>
        <p className="verdict-body">
          합격 기준 {round.passed}개를 전부 통과했습니다. 사용법서를 쓰고 부서에 넘길 수 있습니다.
          {round.human_needed > 0 &&
            ` 다만 사람이 직접 확인해야 하는 기준이 ${round.human_needed}개 남아 있습니다.`}
        </p>
        {caveat && <p className="verdict-caveat">{caveat}</p>}
      </div>
    )
  }

  if (round.overall === '차단') {
    return (
      <div className="verdict verdict-blocked">
        <div className="verdict-head">{round.seq}차 — 배포 차단</div>
        <p className="verdict-body">
          <strong>필수 안전 기준 {round.safety_failed}개가 깨졌습니다.</strong> 다른 기준을{' '}
          {round.passed}개 통과했더라도 넘기지 않습니다. 금액이 틀린 표는 없느니만 못합니다.
          4단계로 돌아가 고친 뒤 다시 시험하세요.
        </p>
      </div>
    )
  }

  return (
    <div className="notice notice-warn">
      <div className="notice-title">{round.seq}차 — 조건부</div>
      <p>
        필수 안전 기준은 지켰지만 {round.failed}개가 통과하지 못했습니다. 넘길지 더 고칠지는
        담당자가 정합니다.
      </p>
      {caveat && <p className="verdict-caveat">{caveat}</p>}
    </div>
  )
}

function ResultCard({ r }) {
  const tone =
    r.verdict === '통과'
      ? 'result-pass'
      : r.verdict === '실패'
        ? 'result-fail'
        : 'result-hold'

  return (
    <div className={`result-card ${tone}`}>
      <div className="row" style={{ marginBottom: 5 }}>
        <span className="result-mark" aria-hidden="true">
          {r.verdict === '통과' ? '✓' : r.verdict === '실패' ? '✕' : '?'}
        </span>
        <span className={`badge ${r.check_kind === 'rule' ? 'badge-accent' : 'badge-neutral'}`}>
          {r.check_kind === 'rule' ? '기계가 채점' : '사람이 확인'}
        </span>
        {r.is_required_safety === 1 && <span className="badge badge-danger">필수 안전</span>}
        <span className="spacer" />
        <span className="card-note">{r.verdict}</span>
      </div>

      <div className="item-body">{r.body}</div>
      {r.evidence && <div className="result-evidence">{r.evidence}</div>}

      {r.samples?.length > 0 && (
        <details className="disclose" style={{ marginTop: 8 }}>
          <summary>어긋난 줄 {r.samples.length}개 보기</summary>
          <div className="disclose-body">
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">합격 기준에서 어긋난 표본</caption>
                <thead>
                  <tr>
                    {Object.keys(r.samples[0]).map((k) => (
                      <th scope="col" key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.samples.map((s, i) => (
                    <tr key={i}>
                      {Object.values(s).map((v, j) => (
                        <td key={j} className={typeof v === 'number' ? 'num' : ''}>
                          {typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

function Rounds({ rounds }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">시험 회차</h2>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">베타 테스트 회차별 판정 결과</caption>
          <thead>
            <tr>
              <th scope="col">회차</th>
              <th scope="col">판정</th>
              <th scope="col" className="num">통과</th>
              <th scope="col" className="num">실패</th>
              <th scope="col" className="num">필수 안전 실패</th>
              <th scope="col">무엇을 고쳤나</th>
              <th scope="col" className="num">채점 시간</th>
              <th scope="col">언제</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.id}>
                <td>{r.seq}</td>
                <td>
                  <span
                    className={`badge ${
                      r.overall === '통과'
                        ? 'badge-success'
                        : r.overall === '차단'
                          ? 'badge-danger'
                          : 'badge-warning'
                    }`}
                  >
                    {r.overall}
                  </span>
                </td>
                <td className="num">{num(r.passed)}</td>
                <td className="num">{num(r.failed)}</td>
                <td className="num">{num(r.safety_failed)}</td>
                <td>{r.fixed_what ?? '—'}</td>
                <td className="num">{ms(r.duration_ms)}</td>
                <td>{ago(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Feedback({ data, id, toast, onDone }) {
  const [form, setForm] = useState({ dept: '', person_label: '', body: '', feedback_kind: '의견' })

  return (
    <section className="card card-boxed">
      <div className="card-head">
        <h2 className="card-title">실제로 써 본 사람이 한 말</h2>
      </div>

      {data.feedback.length > 0 && (
        <div className="stack-sm" style={{ marginBottom: 14 }}>
          {data.feedback.map((f) => (
            <div key={f.id} className={f.resolved_at ? 'decided' : 'draft'}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="badge badge-neutral">{f.dept}</span>
                <span className={`badge ${f.kind === '막힌곳' ? 'badge-danger' : 'badge-accent'}`}>
                  {f.kind}
                </span>
                <span className="card-note">{f.person_label}</span>
                <span className="spacer" />
                <span className="card-note">{ago(f.created_at)}</span>
              </div>
              <div className="item-body">{f.body}</div>
              {f.resolution && (
                <div className="decision-why">
                  <strong>어떻게 했나</strong> {f.resolution}
                </div>
              )}
              {!f.resolved_at && (
                <div className="item-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={async () => {
                      const r = window.prompt('어떻게 처리했나요?')
                      if (r == null) return
                      try {
                        await api.post(`/applications/${id}/beta`, {
                          kind: 'resolve_feedback',
                          id: f.id,
                          resolution: r,
                        })
                        await onDone()
                      } catch (err) {
                        toast.error(err.message)
                      }
                    }}
                  >
                    처리했음으로
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="field-row">
        <select value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })}>
          <option value="">부서</option>
          {DEPTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={form.person_label}
          onChange={(e) => setForm({ ...form, person_label: e.target.value })}
          placeholder="누가"
        />
        <select
          value={form.feedback_kind}
          onChange={(e) => setForm({ ...form, feedback_kind: e.target.value })}
        >
          {['의견', '막힌곳', '요청', '칭찬'].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <textarea
        rows={2}
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
        placeholder="들은 말 그대로 — 예: 검토함에 뜬 게 뭘 하라는 건지 모르겠어요"
        style={{ width: '100%', marginTop: 8 }}
      />
      <button
        type="button"
        className="btn-ghost"
        style={{ marginTop: 8 }}
        onClick={async () => {
          if (!form.body.trim()) {
            toast.error('들은 말을 적어주세요.')
            return
          }
          try {
            await api.post(`/applications/${id}/beta`, { kind: 'feedback', ...form })
            setForm({ ...form, body: '' })
            await onDone()
            toast.success('남겼습니다. 6단계 사용법서의 자주 묻는 것이 됩니다.')
          } catch (err) {
            toast.error(err.message)
          }
        }}
      >
        남기기
      </button>
    </section>
  )
}
