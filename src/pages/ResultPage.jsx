import { useEffect, useMemo, useState } from 'react'
import StageHeader from '../components/StageHeader.jsx'
import { useApi } from '../hooks/useApi.js'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import { krw, num, duration, ago } from '../lib/format.js'

export default function ResultPage() {
  const { data: list } = useApi('/applications')
  const [selectedId, setSelectedId] = useState(null)

  const targets = useMemo(
    () => (list?.items ?? []).filter((a) => ['수용', '진행중', '완료'].includes(a.status)),
    [list]
  )

  useEffect(() => {
    if (!selectedId && targets.length > 0) setSelectedId(targets[0].id)
  }, [targets, selectedId])

  return (
    <div className="stack">
      <StageHeader stageKey="result" />

      {targets.length === 0 ? (
        <div className="empty">
          <div className="empty-title">정리할 성과가 없습니다</div>
          <div className="empty-sub">부서에 넘긴 도구가 여기로 넘어옵니다.</div>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {targets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selectedId === a.id ? ' on' : ''}`}
                onClick={() => setSelectedId(a.id)}
              >
                {a.dept} · {a.title.slice(0, 22)}
                {a.title.length > 22 && '…'}
              </button>
            ))}
          </div>
          {selectedId && <Result id={selectedId} />}
        </>
      )}
    </div>
  )
}

function Result({ id }) {
  const { data, error, loading, reload } = useApi(`/applications/${id}/outcome`)
  const toast = useToast()
  const [inputs, setInputs] = useState({ dev_hours: '', ops_cost_krw: '', next_bottleneck: '' })

  useEffect(() => {
    if (!data) return
    setInputs({
      dev_hours: String(data.saved?.dev_hours ?? ''),
      ops_cost_krw: String(data.saved?.ops_cost_krw ?? ''),
      next_bottleneck: data.saved?.next_bottleneck ?? '',
    })
  }, [data])

  async function send(body, msg) {
    try {
      await api.post(`/applications/${id}/outcome`, body)
      toast.success(msg)
      await reload()
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading && !data) return <div className="page-loading">불러오는 중…</div>
  if (error) return <div className="notice notice-danger">{error}</div>
  if (!data) return null

  const o = data.outcome

  if (o.status === '산정불가') {
    return (
      <div className="stack">
        <div className="notice notice-warn">
          <div className="notice-title">아직 성과를 말할 수 없습니다</div>
          <p>{o.reason}</p>
        </div>
        {data.claimed && (
          <ClaimedVsMeasured claimed={data.claimed} baseline={data.baseline} />
        )}
      </div>
    )
  }

  return (
    <div className="stack">
      <section className={`outcome-headline tone-${data.label.tone}`}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span
            className={`badge ${
              data.label.tone === 'ok'
                ? 'badge-success'
                : data.label.tone === 'warn'
                  ? 'badge-warning'
                  : 'badge-neutral'
            }`}
          >
            {data.label.label}
          </span>
          <span className="badge badge-warning">기준선 표본 {o.baselineSampleN}회</span>
          <span className="card-note">{o.runCount}번 돌린 결과</span>
        </div>

        <div className="outcome-number">{krw(o.netKrw)}</div>
        <div className="card-note">
          아낀 시간 {duration(o.savedSeconds)} · 만든 공수와 운영비를 뺀 뒤의 금액입니다
        </div>
        {data.label.note && <p className="outcome-warn">{data.label.note}</p>}
      </section>

      <ClaimedVsMeasured claimed={data.claimed} baseline={data.baseline} />

      <section className="card">
        <div className="card-head">
          <span className="card-title">어떻게 나온 숫자인가</span>
          <span className="card-note">접어 두지 않습니다</span>
        </div>

        <div className="formula">
          {o.formula.map((f, i) => (
            <div key={i} className={`formula-row${f.strong ? ' strong' : ''}`}>
              <span className="formula-label">
                {f.label}
                {f.note && <span className="card-note"> {f.note}</span>}
              </span>
              <span className="formula-value">{duration(Math.abs(f.value))}</span>
            </div>
          ))}
        </div>

        <div className="formula" style={{ marginTop: 14 }}>
          {o.moneyFormula.map((f, i) => (
            <div key={i} className={`formula-row${f.strong ? ' strong' : ''}`}>
              <span className="formula-label">
                {f.label}
                {f.note && <span className="card-note"> {f.note}</span>}
              </span>
              <span className="formula-value">{krw(f.value)}</span>
            </div>
          ))}
        </div>

        {data.annual && (
          <div className="notice notice-info" style={{ marginTop: 14 }}>
            <div className="notice-title">
              연 단위로는 {num(data.annual.hours, 1)}시간 · {krw(data.annual.krw)}
            </div>
            <p>{data.annual.note}</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">계산에 넣을 값</span>
          <span className="card-note">적게 잡으면 성과가 커 보입니다</span>
        </div>
        <div className="field-row">
          <Field label="만드는 데 든 시간" hint="회의·시험·고친 시간까지">
            <input
              inputMode="numeric"
              value={inputs.dev_hours}
              onChange={(e) => setInputs({ ...inputs, dev_hours: e.target.value })}
              placeholder="시간"
            />
          </Field>
          <Field label="운영비" hint="있으면">
            <input
              inputMode="numeric"
              value={inputs.ops_cost_krw}
              onChange={(e) => setInputs({ ...inputs, ops_cost_krw: e.target.value })}
              placeholder="원"
            />
          </Field>
        </div>
        <Field label="이 과정에서 새로 발견한 병목" hint="다음 신청서가 됩니다">
          <input
            value={inputs.next_bottleneck}
            onChange={(e) => setInputs({ ...inputs, next_bottleneck: e.target.value })}
          />
        </Field>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => send({ kind: 'inputs', ...inputs }, '다시 계산했습니다.')}
        >
          저장하고 다시 계산
        </button>
      </section>

      <Challenges data={data} send={send} toast={toast} />

      <section className="card">
        <div className="card-head">
          <span className="card-title">부서가 확인했나</span>
          <span className="card-note">만든 사람만 아는 성과는 성과가 아닙니다</span>
        </div>
        {data.saved?.dept_confirmed_at ? (
          <div className="decided">
            <span className="origin-label origin-human">
              ◆ {data.saved.dept_confirmed_by} · {ago(data.saved.dept_confirmed_at)}
            </span>
            <div className="item-body">{data.saved.dept_comment || '맞다고 확인했습니다.'}</div>
          </div>
        ) : (
          <>
            <p className="card-note" style={{ marginBottom: 10 }}>
              이 숫자를 실제로 쓰는 부서가 아직 확인해 주지 않았습니다.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const by = window.prompt('누가 확인했나요?')
                if (by == null) return
                const comment = window.prompt('뭐라고 하셨나요? (선택)') ?? ''
                send({ kind: 'dept_confirm', by, comment }, '확인 기록을 남겼습니다.')
              }}
            >
              부서 확인 받았음
            </button>
          </>
        )}
      </section>
    </div>
  )
}

// 신청서에 적힌 체감값과 실제로 잰 값을 나란히 둔다.
// 얼마나 다른지가 그 자체로 볼거리다 — 그래서 실측이 필요하다.
function ClaimedVsMeasured({ claimed, baseline }) {
  if (!claimed && !baseline) return null
  const claimedSec = claimed?.minutes ? claimed.minutes * 60 : null
  const gap =
    claimedSec && baseline ? Math.round(((baseline.median_seconds - claimedSec) / claimedSec) * 100) : null

  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">체감과 실측</span>
      </div>
      <div className="grid-2">
        <div className="card-flat">
          <div className="card-note">신청서에 적힌 체감 (1단계)</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {claimedSec ? duration(claimedSec) : '미기재'}
          </div>
          {claimed?.frequency && <div className="card-note">{claimed.frequency}</div>}
        </div>
        <div className="card-flat">
          <div className="card-note">스톱워치로 잰 값 (3단계)</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {baseline ? duration(baseline.median_seconds) : '아직 안 잼'}
          </div>
          {baseline && (
            <div className="card-note">
              표본 {baseline.sample_n}회 · {duration(baseline.min_seconds)}~
              {duration(baseline.max_seconds)}
            </div>
          )}
        </div>
      </div>
      {gap != null && (
        <p className="card-note" style={{ marginTop: 10 }}>
          체감보다 실제가 <strong>{gap > 0 ? `${gap}% 더` : `${Math.abs(gap)}% 덜`}</strong> 걸렸습니다.
          만들고 나서 기억으로 적었다면 이만큼 틀렸을 숫자입니다.
        </p>
      )}
    </section>
  )
}

function Challenges({ data, send, toast }) {
  return (
    <section className="card">
      <div className="card-head">
        <span className="card-title">이 숫자를 의심해보세요</span>
        <span className="card-note">
          해소하지 못한 것 {data.unresolvedCount}개 / 전체 {data.challenges.length}개
        </span>
      </div>

      <p className="card-note" style={{ marginBottom: 12 }}>
        스스로 반박합니다. 반박은 <strong>정해진 여덟 가지</strong>이고 해당되면 반드시 뜹니다.
        매번 다르게 반박하면 그건 반박이 아니라 장식입니다.
      </p>

      {data.challenges.length === 0 ? (
        <p className="card-note">해당되는 의심이 없습니다.</p>
      ) : (
        <div className="stack-sm">
          {data.challenges.map((c) => (
            <div key={c.code} className={c.resolved_at ? 'decided' : 'draft'}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className={`badge ${c.resolved_at ? 'badge-success' : 'badge-warning'}`}>
                  {c.resolved_at ? '해소됨' : '아직'}
                </span>
                <strong style={{ color: 'var(--text-h)', fontSize: 14 }}>{c.title}</strong>
              </div>
              <div className="card-note">{c.body}</div>
              {c.resolution && (
                <div className="decision-why">
                  <strong>어떻게 확인했나</strong> {c.resolution}
                </div>
              )}
              {!c.resolved_at && (
                <div className="item-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      const r = window.prompt('어떻게 확인하셨나요?')
                      if (!r) {
                        if (r === '') toast.error('어떻게 확인했는지 적어야 해소됩니다.')
                        return
                      }
                      send(
                        {
                          kind: 'resolve_challenge',
                          rule_code: c.code,
                          title: c.title,
                          body: c.body,
                          resolution: r,
                        },
                        '해소했습니다.'
                      )
                    }}
                  >
                    확인했음
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
