import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { dossierText, dossierFilename, progressOf, STAGE_ORDER } from '../../shared/dossier.js'
import { dateTimeLabel, duration, krw, num } from '../lib/format.js'

// 신청서 한 건의 기록 전부를 한 문서로 편다.
//
// 여덟 단계가 여덟 화면에 흩어져 있으면, 신청서 한 건이 어떻게 시작해서
// 어떻게 끝났는지 보려면 화면을 여덟 번 옮겨 다녀야 한다. 기록을 남기는
// 것과 꺼내 보는 것은 다른 일이고, 꺼낼 수 없는 기록은 그냥 저장이다.
//
// 인쇄를 염두에 두고 만들었다. 부서에 보내거나 결재에 붙이거나 감사에
// 내는 것은 결국 종이나 PDF다. 화면 주소를 보내면 상대는 로그인부터 해야 한다.
//
// 빈 단계를 숨기지 않는다. "아직 하지 않았습니다"라고 적는다. 하지 않은
// 것을 안 보이게 하면 여덟 단계를 다 밟은 것처럼 보이기 때문이다.
export default function RecordPage() {
  const { id } = useParams()
  const [rec, setRec] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .get(`/applications/${encodeURIComponent(id)}/record`)
      .then((r) => alive && setRec(r))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [id])

  function download() {
    const text = dossierText(rec)
    // 엑셀·메모장이 한글을 CP949로 오해하지 않도록 BOM을 붙인다.
    // 이거 하나 빠지면 윈도우 메모장에서 전부 깨져 보인다.
    const blob = new Blob([`﻿${text}`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = dossierFilename(rec.application)
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) {
    return (
      <div className="record-shell">
        <div className="notice notice-danger">{error}</div>
        <Link to="/review" className="btn-ghost">
          검토 화면으로
        </Link>
      </div>
    )
  }
  if (!rec) return <div className="page-loading">기록을 모으는 중…</div>

  const a = rec.application
  const p = progressOf(rec.done)

  return (
    <div className="record-shell">
      <div className="record-actions no-print">
        <Link to="/review" className="btn-ghost btn-sm">
          ← 검토 화면
        </Link>
        <span className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={download}>
          텍스트로 내려받기
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => window.print()}>
          인쇄 · PDF로 저장
        </button>
      </div>

      <article className="record">
        <header className="record-head">
          <div className="record-eyebrow">
            <span className="mono">{a.ticket_no}</span>
            <span>·</span>
            <span>
              {a.dept} {a.applicant_label}
            </span>
            <span>·</span>
            <span>{dateTimeLabel(a.created_at)} 접수</span>
          </div>
          <h1>{a.title}</h1>
          <div className="record-progress">
            <div className="record-rail">
              {STAGE_ORDER.map((s) => (
                <span key={s} className={`record-pip${rec.done[s] ? ' on' : ''}`}>
                  {s}
                </span>
              ))}
            </div>
            <p className="record-progress-note">
              여덟 단계 중 <strong>{p.count}단계</strong>까지 기록이 남아 있습니다.
              {p.skipped.length > 0 && ` 건너뛴 단계: ${p.skipped.join(', ')}.`} 빈 단계는 숨기지
              않고 그대로 적습니다.
            </p>
          </div>
        </header>

        {/* ① 신청서 */}
        <Sec n={1} name="신청서" sub="부서가 적어 낸 원문" filled>
          <KV>
            <dt>무엇이 병목인가</dt>
            <dd>{a.bottleneck}</dd>
            <dt>지금 무슨 일이 생기나</dt>
            <dd>{a.problem}</dd>
            {a.wish && (
              <>
                <dt>바라는 해결</dt>
                <dd>{a.wish}</dd>
              </>
            )}
            {a.impact_if_wrong && (
              <>
                <dt>틀리면</dt>
                <dd>{a.impact_if_wrong}</dd>
              </>
            )}
            {a.current_minutes && (
              <>
                <dt>신청자 체감</dt>
                <dd>
                  {duration(a.current_minutes * 60)}
                  {a.current_people ? ` × ${a.current_people}명` : ''}
                  {a.current_frequency ? ` × ${a.current_frequency}` : ''}
                  <span className="record-aside">
                    {a.is_measured ? ' (실측이라고 밝힘)' : ' (체감치 — 3단계에서 직접 잽니다)'}
                  </span>
                </dd>
              </>
            )}
          </KV>
        </Sec>

        {/* ② 검토 */}
        <Sec n={2} name="검토" sub="담당자 판정" filled={Boolean(rec.review)}>
          {rec.review && (
            <>
              <div className="record-verdict">
                <span className={`verdict-mark ${rec.review.verdict}`}>{rec.review.verdict}</span>
                <span className="record-aside">
                  {dateTimeLabel(rec.review.decided_at)} · {rec.review.reviewer_label}
                </span>
              </div>
              <KV>
                <dt>판정 근거</dt>
                <dd>{rec.review.verdict_reason}</dd>
                <dt>임팩트</dt>
                <dd>
                  {rec.review.impact_score}점 — {rec.review.impact_reason}
                </dd>
                <dt>난이도</dt>
                <dd>
                  {rec.review.difficulty_score}점 — {rec.review.difficulty_reason}
                </dd>
                <dt>고려한 대안</dt>
                <dd>{rec.review.alternatives_considered}</dd>
                {rec.review.refuse_alternative && (
                  <>
                    <dt>반려하며 제시한 대안</dt>
                    <dd>{rec.review.refuse_alternative}</dd>
                  </>
                )}
                {rec.review.hold_until_condition && (
                  <>
                    <dt>보류 해제 조건</dt>
                    <dd>{rec.review.hold_until_condition}</dd>
                  </>
                )}
              </KV>
            </>
          )}
        </Sec>

        {/* ③ 협의안 */}
        <Sec
          n={3}
          name="협의안"
          sub="부서와 정한 것"
          filled={rec.requirements.length > 0 || rec.criteria.length > 0}
        >
          {rec.stakeholders.length > 0 && (
            <Sub title={`이해관계자 ${rec.stakeholders.length}명`}>
              <ul className="record-list">
                {rec.stakeholders.map((s) => (
                  <li key={s.id}>
                    <strong>
                      {s.dept} {s.person_label}
                    </strong>{' '}
                    <span className="record-aside">
                      {s.role_label}
                      {s.is_owner ? ' · 주관' : ''}
                    </span>
                    <div>원하는 것 — {s.wants}</div>
                  </li>
                ))}
              </ul>
            </Sub>
          )}

          {rec.meetings.length > 0 && (
            <Sub title={`회의 ${rec.meetings.length}건`}>
              <ul className="record-list">
                {rec.meetings.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.seq}차 「{m.title}」
                    </strong>{' '}
                    <span className="record-aside">
                      {m.held_at ? dateTimeLabel(m.held_at) : '일시 미정'} · {m.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Sub>
          )}

          {rec.requirements.length > 0 && (
            <Sub
              title={`회의에서 나온 것 ${rec.requirements.length}건`}
              note={`채택 ${rec.requirements.filter((r) => r.status.includes('채택')).length} · 기각 ${rec.requirements.filter((r) => r.status === '기각').length} — 기각한 것도 사유와 함께 남깁니다`}
            >
              <ul className="record-list">
                {rec.requirements.map((r) => (
                  <li key={r.id} className={r.status === '기각' ? 'struck' : ''}>
                    <span className="badge badge-neutral">{r.kind}</span>{' '}
                    <span className="badge badge-neutral">{r.priority}</span>{' '}
                    <span className={`badge ${r.status === '기각' ? 'badge-warning' : 'badge-accent'}`}>
                      {r.status}
                    </span>{' '}
                    <strong>{r.dept}</strong>{' '}
                    {r.status === '수정채택' && r.decided_body ? r.decided_body : r.body}
                    {r.status === '기각' && r.reject_reason && (
                      <div className="record-aside">기각 사유 — {r.reject_reason}</div>
                    )}
                    {r.quote && <blockquote className="record-quote">“{r.quote}”</blockquote>}
                  </li>
                ))}
              </ul>
            </Sub>
          )}

          {rec.conflicts.length > 0 && (
            <Sub title={`요구 충돌 ${rec.conflicts.length}건`}>
              <ul className="record-list">
                {rec.conflicts.map((c) => (
                  <li key={c.id}>
                    <strong>{c.reason}</strong>
                    {c.tradeoff_axis && <span className="record-aside"> · {c.tradeoff_axis}</span>}
                    <div>
                      {c.verdict ? (
                        <>
                          <span className="badge badge-accent">{c.verdict}</span> {c.verdict_reason}
                        </>
                      ) : (
                        <span className="badge badge-warning">아직 판정하지 않음</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Sub>
          )}

          {rec.criteria.length > 0 && (
            <Sub
              title={`합격 기준 ${rec.criteria.length}개`}
              note="만들기 전에 정했습니다. 결과를 보고 기준을 움직이지 않기 위해서입니다."
            >
              <ol className="record-list numbered">
                {rec.criteria.map((c) => (
                  <li key={c.id}>
                    {c.body}
                    {c.is_required_safety === 1 && (
                      <span className="badge badge-danger"> 필수 안전 — 깨지면 배포 차단</span>
                    )}
                    <span className="record-aside">
                      {' '}
                      · {c.check_kind === 'rule' ? '기계가 자동 판정' : '사람이 확인'}
                    </span>
                  </li>
                ))}
              </ol>
            </Sub>
          )}

          {rec.baseline && (
            <Sub title="봉인된 기준선">
              <p className="record-seal">
                <strong>{duration(rec.baseline.median_seconds)}</strong> — 표본{' '}
                {rec.baseline.sample_n}회의 중앙값, {dateTimeLabel(rec.baseline.sealed_at)} 봉인.
              </p>
              <p className="record-aside">
                표본 {rec.baseline.sample_n}회는 통계적으로 약합니다. 그래서 이 값에는 신뢰구간을
                붙이지 않습니다. 이후 모든 절감 주장은 이 값 위에서만 계산됩니다.
              </p>
              {rec.shadowRuns.length > 0 && (
                <ul className="record-list tight">
                  {rec.shadowRuns.map((r) => (
                    <li key={r.id}>
                      {r.seq}회차 {duration(r.total_seconds)} · 오류 {r.error_count}건
                      {r.note && <span className="record-aside"> — {r.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Sub>
          )}
        </Sec>

        {/* ④ 제작 */}
        <Sec n={4} name="제작" sub="실제로 돌린 기록" filled={rec.builds.length > 0}>
          <ul className="record-list">
            {rec.builds.map((b) => {
              const t = parseJson(b.totals_json)
              return (
                <li key={b.id}>
                  <strong>{b.seq}회차</strong>{' '}
                  <span className="record-aside">{dateTimeLabel(b.created_at)}</span>
                  <div>
                    결과 {num(b.rows_out)}줄 · 격리 {num(b.quarantined)}줄 · 중복 의심{' '}
                    {num(b.duplicate_suspects)}건 · {num(b.duration_ms)}ms
                  </div>
                  {t?.gross != null && <div>합계 매출 {krw(t.gross)}</div>}
                  {b.note && <div className="record-aside">{b.note}</div>}
                </li>
              )
            })}
          </ul>
        </Sec>

        {/* ⑤ 베타테스트 */}
        <Sec
          n={5}
          name="베타테스트"
          sub="3단계에서 정한 합격 기준으로 채점"
          filled={rec.betaRounds.length > 0}
        >
          {rec.betaRounds.map((r) => (
            <Sub
              key={r.id}
              title={`${r.seq}차 — ${r.overall}`}
              note={`통과 ${r.passed}/${r.total} · 실패 ${r.failed} · 필수 안전 실패 ${r.safety_failed}`}
            >
              {r.fixed_what && <p>이번에 고친 것 — {r.fixed_what}</p>}
              <ul className="record-list tight">
                {rec.betaResults
                  .filter((x) => x.round_id === r.id)
                  .map((x) => (
                    <li key={x.id} className={x.verdict === '통과' ? 'pass' : 'fail'}>
                      <span className="record-mark">{x.verdict === '통과' ? '○' : '×'}</span>{' '}
                      {x.body}
                      {x.is_required_safety === 1 && (
                        <span className="badge badge-danger"> 필수 안전</span>
                      )}
                      {x.evidence && <div className="record-aside">근거 — {x.evidence}</div>}
                    </li>
                  ))}
              </ul>
            </Sub>
          ))}

          {rec.betaFeedback.length > 0 && (
            <Sub
              title={`실제로 써 본 사람이 한 말 ${rec.betaFeedback.length}건`}
              note="기계 채점이 통과여도 사람이 못 쓰겠다고 하면 못 쓰는 것입니다."
            >
              <ul className="record-list">
                {rec.betaFeedback.map((f) => (
                  <li key={f.id}>
                    <span className="badge badge-neutral">{f.kind}</span>{' '}
                    <strong>
                      {f.dept} {f.person_label}
                    </strong>
                    <div>{f.body}</div>
                    <div className="record-aside">
                      {f.resolution ? `→ ${f.resolution}` : '→ 아직 처리하지 않았습니다'}
                    </div>
                  </li>
                ))}
              </ul>
            </Sub>
          )}
        </Sec>

        {/* ⑥ 사용법서 */}
        <Sec n={6} name="사용법서" sub="부서가 읽을 것" filled={Boolean(rec.manual)}>
          {rec.manual && (
            <>
              <KV>
                {rec.manual.intro && (
                  <>
                    <dt>이게 무엇인가</dt>
                    <dd>{rec.manual.intro}</dd>
                  </>
                )}
                {rec.manual.when_to_run && (
                  <>
                    <dt>언제 돌리나</dt>
                    <dd>{rec.manual.when_to_run}</dd>
                  </>
                )}
                {rec.manual.what_to_do_after && (
                  <>
                    <dt>결과를 받으면</dt>
                    <dd>{rec.manual.what_to_do_after}</dd>
                  </>
                )}
                {rec.manual.contact && (
                  <>
                    <dt>막히면</dt>
                    <dd>{rec.manual.contact}</dd>
                  </>
                )}
                {rec.manual.notes && (
                  <>
                    <dt>그 밖에</dt>
                    <dd>{rec.manual.notes}</dd>
                  </>
                )}
              </KV>
              {rec.faqs.length > 0 && (
                <Sub title={`자주 묻는 것 ${rec.faqs.length}개`}>
                  <dl className="record-faq">
                    {rec.faqs.map((f) => (
                      <div key={f.id}>
                        <dt>Q. {f.question}</dt>
                        <dd>A. {f.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </Sub>
              )}
            </>
          )}
        </Sec>

        {/* ⑦ 배포 */}
        <Sec n={7} name="배포" sub="부서에 넘김" filled={Boolean(rec.handover)}>
          {rec.handover && (
            <KV>
              <dt>주소</dt>
              <dd className="mono">/t/{rec.handover.slug}</dd>
              <dt>넘긴 곳</dt>
              <dd>
                {rec.handover.handed_to_dept} {rec.handover.handed_to_person} ·{' '}
                {dateTimeLabel(rec.handover.handed_at)}
              </dd>
              <dt>부서가 받았다고 확인</dt>
              <dd>
                {rec.handover.accepted_at ? (
                  `${dateTimeLabel(rec.handover.accepted_at)} · ${rec.handover.accepted_by ?? ''}`
                ) : (
                  <span className="record-aside">
                    아직 확인하지 않았습니다 — 넘겼다고 받은 것이 아닙니다
                  </span>
                )}
              </dd>
              <dt>사용 한도</dt>
              <dd>
                하루 {rec.handover.daily_limit}회 · 파일 {rec.handover.max_file_mb}MB
              </dd>
              <dt>넘긴 뒤 실제 사용</dt>
              <dd>
                {rec.uses.length > 0
                  ? `${num(rec.uses.length)}회 (실패 ${rec.uses.filter((u) => !u.ok).length}회)`
                  : '아직 한 번도 쓰이지 않았습니다.'}
              </dd>
              {rec.handover.rolled_back_at && (
                <>
                  <dt>되돌림</dt>
                  <dd>
                    {dateTimeLabel(rec.handover.rolled_back_at)} — {rec.handover.rollback_reason}
                  </dd>
                </>
              )}
            </KV>
          )}
        </Sec>

        {/* ⑧ 성과 */}
        <Sec n={8} name="성과" sub="봉인한 기준선과 대조" filled={Boolean(rec.outcome)}>
          {rec.outcome && (
            <>
              <KV>
                <dt>만든 공수</dt>
                <dd>
                  {rec.outcome.dev_hours}시간 · {rec.outcome.amortize_months}개월 상각
                </dd>
                <dt>운영 비용</dt>
                <dd>{krw(rec.outcome.ops_cost_krw)}</dd>
                <dt>부서 확인</dt>
                <dd>
                  {rec.outcome.dept_confirmed_at ? (
                    <>
                      {dateTimeLabel(rec.outcome.dept_confirmed_at)} ·{' '}
                      {rec.outcome.dept_confirmed_by}
                      {rec.outcome.dept_comment && <div>“{rec.outcome.dept_comment}”</div>}
                    </>
                  ) : (
                    <span className="record-aside">
                      아직 확인받지 못했습니다 — 만든 사람만 아는 성과는 성과가 아닙니다
                    </span>
                  )}
                </dd>
                {rec.outcome.next_bottleneck && (
                  <>
                    <dt>이 과정에서 새로 찾은 병목</dt>
                    <dd>{rec.outcome.next_bottleneck}</dd>
                  </>
                )}
              </KV>

              {rec.challenges.length > 0 && (
                <Sub
                  title={`이 숫자를 의심해보세요 — 자기 반박 ${rec.challenges.length}건`}
                  note={`미해소 ${rec.challenges.filter((c) => !c.resolved_at).length}건`}
                >
                  <ul className="record-list">
                    {rec.challenges.map((c) => (
                      // 살아 있는 반박은 저장된 줄이 아니라 규칙이 만든
                      // 것이라 id 가 없다. 규칙 코드가 그 자리를 대신한다.
                      <li key={c.rule_code ?? c.id}>
                        <span className={`badge ${c.resolved_at ? 'badge-accent' : 'badge-warning'}`}>
                          {c.resolved_at ? '해소' : '미해소'}
                        </span>{' '}
                        <strong>{c.title}</strong>
                        <div>{c.body}</div>
                        {c.resolution && <div className="record-aside">→ {c.resolution}</div>}
                      </li>
                    ))}
                  </ul>
                </Sub>
              )}
            </>
          )}
        </Sec>

        {/* 결정 기록 */}
        {rec.decisions.length > 0 && (
          <section className="record-sec">
            <h2>
              <span className="record-secno">기록</span> 이 신청서에서 내린 결정{' '}
              {rec.decisions.length}건
            </h2>
            <p className="record-aside">
              무엇을·왜·무엇을 고르지 않았는지가 함께 남습니다. 근거 없이 남은 결정은 나중에 아무
              쓸모가 없습니다.
            </p>
            <ol className="record-decisions">
              {rec.decisions.map((d) => (
                <li key={d.id}>
                  <div className="record-decision-head">
                    <span className="badge badge-accent">{d.stage}</span>
                    {d.unrequested === 1 && (
                      <span className="badge badge-warning">요청받지 않았으나 먼저 제안</span>
                    )}
                    <span className="spacer" />
                    <span className="record-aside">{dateTimeLabel(d.created_at)}</span>
                  </div>
                  <strong>{d.title}</strong>
                  <div>{d.what}</div>
                  <div className="record-why">
                    <strong>왜</strong> {d.why}
                  </div>
                  {d.alternatives && (
                    <div className="record-why">
                      <strong>고르지 않은 길</strong> {d.alternatives}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className="record-foot">
          <p>
            이 문서는 일손(ILSON)이 기록에서 그대로 뽑은 것입니다. 빈 칸은 아직 하지 않은 일이고,
            하지 않은 것을 한 것처럼 채우지 않습니다.
          </p>
          <p className="record-aside">뽑은 시각 {dateTimeLabel(rec.generatedAt)}</p>
        </footer>
      </article>
    </div>
  )
}

function Sec({ n, name, sub, filled, children }) {
  return (
    <section className={`record-sec${filled ? '' : ' empty'}`}>
      <h2>
        <span className="record-secno">{n}</span> {name}
        <span className="record-subtitle">{sub}</span>
      </h2>
      {filled ? children : <p className="record-empty">아직 여기까지 오지 않았습니다.</p>}
    </section>
  )
}

function Sub({ title, note, children }) {
  return (
    <div className="record-sub">
      <h3>{title}</h3>
      {note && <p className="record-aside">{note}</p>}
      {children}
    </div>
  )
}

function KV({ children }) {
  return <dl className="kv record-kv">{children}</dl>
}

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
