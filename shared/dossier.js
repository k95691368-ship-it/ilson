// 신청서 한 건의 기록을 글 한 편으로 편다.
//
// 화면은 스크롤하며 보는 것이지만, 기록은 남에게 건네야 할 때가 온다.
// 부서에 "그동안 이렇게 진행됐습니다"를 보낼 때, 감사 때 "이 결정은 누가
// 언제 왜 했습니까"를 물을 때. 그때 화면 주소를 보내면 상대는 로그인하고
// 여덟 화면을 돌아다녀야 한다.
//
// 그래서 텍스트로 편다. 텍스트인 이유는 메일에 붙여 넣어도 안 깨지고,
// 10년 뒤에도 열리고, 검색이 되기 때문이다. PDF는 인쇄 기능으로 만든다.
//
// 이 파일은 브라우저와 서버 양쪽에서 쓴다. 그래서 DOM도 D1도 건드리지 않는
// 순수 함수만 둔다.

const STAGE_ORDER = [
  '신청서',
  '검토',
  '협의안',
  '제작',
  '베타테스트',
  '사용법서',
  '배포',
  '성과',
]

export { STAGE_ORDER }

function line(label, value) {
  if (value == null || value === '') return null
  return `${label}: ${value}`
}

function block(title, lines) {
  const body = lines.filter(Boolean)
  if (body.length === 0) return null
  return `${title}\n${'-'.repeat(40)}\n${body.join('\n')}`
}

function when(sqlTime) {
  if (!sqlTime) return null
  return String(sqlTime).replace('T', ' ').replace('Z', '').slice(0, 16)
}

function minutes(seconds) {
  if (seconds == null) return null
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}분 ${s}초` : `${s}초`
}

// 진행률. "8단계 중 5단계"는 기록의 첫 줄에 있어야 할 정보다.
export function progressOf(done) {
  const reached = STAGE_ORDER.filter((s) => done?.[s])
  return {
    reached,
    count: reached.length,
    total: STAGE_ORDER.length,
    // 중간이 비어 있는 채로 뒤가 채워졌다면 그것도 사실대로 적는다.
    // 순서대로 밟지 않은 것을 숨기면 기록이 아니다.
    skipped: STAGE_ORDER.slice(0, STAGE_ORDER.lastIndexOf(reached[reached.length - 1]) + 1).filter(
      (s) => !done?.[s]
    ),
  }
}

export function dossierText(record) {
  const {
    application: a,
    review,
    stakeholders = [],
    meetings = [],
    requirements = [],
    conflicts = [],
    criteria = [],
    shadowRuns = [],
    baseline,
    builds = [],
    betaRounds = [],
    betaResults = [],
    betaFeedback = [],
    manual,
    faqs = [],
    handover,
    uses = [],
    outcome,
    challenges = [],
    decisions = [],
    done = {},
    generatedAt,
  } = record

  const p = progressOf(done)
  const out = []

  out.push(
    [
      '='.repeat(60),
      `신청서 기록  ${a.ticket_no}`,
      a.title,
      '='.repeat(60),
      `${a.dept} · ${a.applicant_label} · ${when(a.created_at)} 접수`,
      `여덟 단계 중 ${p.count}단계까지 기록됨 — ${p.reached.join(' → ') || '없음'}`,
      p.skipped.length > 0 ? `건너뛴 단계: ${p.skipped.join(', ')}` : null,
      `이 문서를 뽑은 시각: ${when(generatedAt)}`,
    ]
      .filter(Boolean)
      .join('\n')
  )

  // ① 신청서
  out.push(
    block('[1] 신청서 — 부서가 적어 낸 원문', [
      line('무엇이 병목인가', a.bottleneck),
      line('지금 무슨 일이 생기나', a.problem),
      line('바라는 해결', a.wish),
      line('틀리면', a.impact_if_wrong),
      line(
        '신청자 체감',
        a.current_minutes
          ? `${a.current_minutes}분${a.current_people ? ` × ${a.current_people}명` : ''}${a.current_frequency ? ` × ${a.current_frequency}` : ''}${a.is_measured ? ' (실측이라 밝힘)' : ' (체감치)'}`
          : null
      ),
      line('연락처', a.contact),
    ])
  )

  // ② 검토
  out.push(
    review
      ? block('[2] 검토 — 담당자 판정', [
          line('판정', `${review.verdict} (${when(review.decided_at)}, ${review.reviewer_label})`),
          line('판정 근거', review.verdict_reason),
          line('임팩트', `${review.impact_score}점 — ${review.impact_reason}`),
          line('난이도', `${review.difficulty_score}점 — ${review.difficulty_reason}`),
          line('고려한 대안', review.alternatives_considered),
          line('반려 사유 코드', review.refuse_code),
          line('반려하며 제시한 대안', review.refuse_alternative),
          line('보류 해제 조건', review.hold_until_condition),
        ])
      : block('[2] 검토', ['아직 판정하지 않았습니다.'])
  )

  // ③ 협의안
  const conflictLines = conflicts.map((c) => {
    const head = `· ${c.reason}${c.tradeoff_axis ? ` [${c.tradeoff_axis}]` : ''} (심각도 ${c.severity})`
    if (!c.verdict) return `${head}\n    → 아직 판정하지 않음`
    return `${head}\n    → ${c.verdict}: ${c.verdict_reason ?? ''}`
  })

  out.push(
    block('[3] 협의안 — 부서와 정한 것', [
      stakeholders.length > 0
        ? `이해관계자 ${stakeholders.length}명\n${stakeholders
            .map(
              (s) =>
                `· ${s.dept} ${s.person_label}(${s.role_label})${s.is_owner ? ' [주관]' : ''} — 원하는 것: ${s.wants}`
            )
            .join('\n')}`
        : null,
      meetings.length > 0
        ? `회의 ${meetings.length}건\n${meetings
            .map((m) => `· ${m.seq}차 「${m.title}」 ${when(m.held_at) ?? '일시 미정'} — ${m.status}`)
            .join('\n')}`
        : null,
      requirements.length > 0
        ? `회의에서 나온 것 ${requirements.length}건 (채택 ${requirements.filter((r) => r.status === '채택' || r.status === '수정채택').length} / 기각 ${requirements.filter((r) => r.status === '기각').length})\n${requirements
            .map((r) => {
              const body = r.status === '수정채택' && r.decided_body ? r.decided_body : r.body
              const tail =
                r.status === '기각' && r.reject_reason ? ` — 기각 사유: ${r.reject_reason}` : ''
              const quote = r.quote ? `\n    회의록 인용: "${r.quote}"` : ''
              return `· [${r.kind}/${r.priority}/${r.status}] ${r.dept}: ${body}${tail}${quote}`
            })
            .join('\n')}`
        : null,
      conflictLines.length > 0 ? `요구 충돌 ${conflicts.length}건\n${conflictLines.join('\n')}` : null,
      criteria.length > 0
        ? `합격 기준 ${criteria.length}개 — 만들기 전에 정했습니다\n${criteria
            .map(
              (c) =>
                `${c.ord}. ${c.body}${c.is_required_safety ? ' [필수 안전 — 깨지면 배포 차단]' : ''} (${c.check_kind === 'rule' ? '자동 판정' : '사람 확인'})`
            )
            .join('\n')}`
        : null,
      shadowRuns.length > 0
        ? `자동화 전 실측 ${shadowRuns.length}회\n${shadowRuns
            .map((r) => `· ${r.seq}회차 ${minutes(r.total_seconds)}, 오류 ${r.error_count}건`)
            .join('\n')}`
        : null,
      baseline
        ? `봉인된 기준선: ${minutes(baseline.median_seconds)} (표본 ${baseline.sample_n}회 중앙값, ${when(baseline.sealed_at)} 봉인)\n    표본 ${baseline.sample_n}회는 통계적으로 약합니다. 이 값에 신뢰구간을 붙이지 않습니다.\n    이후 모든 절감 주장은 이 값 위에서만 계산됩니다.`
        : null,
    ])
  )

  // ④ 제작
  out.push(
    builds.length > 0
      ? block('[4] 제작 — 실제로 돌린 기록', [
          ...builds.map((b) => {
            const t = safeJson(b.totals_json)
            return [
              `· ${b.seq}회차 ${when(b.created_at)} — 결과 ${b.rows_out}줄, 격리 ${b.quarantined}줄, 중복 의심 ${b.duplicate_suspects}건, ${b.duration_ms}ms`,
              t?.gross != null ? `    합계 매출 ${Math.round(t.gross).toLocaleString('ko-KR')}원` : null,
              b.note ? `    ${b.note}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          }),
        ])
      : block('[4] 제작', ['아직 돌린 기록이 없습니다.'])
  )

  // ⑤ 베타테스트
  out.push(
    betaRounds.length > 0
      ? block('[5] 베타테스트 — 합격 기준으로 채점', [
          ...betaRounds.map((r) => {
            const rows = betaResults.filter((x) => x.round_id === r.id)
            return [
              `· ${r.seq}차 [${r.overall}] 통과 ${r.passed}/${r.total}, 실패 ${r.failed}, 필수 안전 실패 ${r.safety_failed} (${when(r.created_at)})`,
              r.fixed_what ? `    이번에 고친 것: ${r.fixed_what}` : null,
              ...rows.map(
                (x) =>
                  `    ${x.verdict === '통과' ? '○' : '×'} ${x.body}${x.is_required_safety ? ' [필수 안전]' : ''}${x.evidence ? `\n        근거: ${x.evidence}` : ''}`
              ),
            ]
              .filter(Boolean)
              .join('\n')
          }),
          betaFeedback.length > 0
            ? `\n실제로 써 본 사람이 한 말 ${betaFeedback.length}건\n${betaFeedback
                .map(
                  (f) =>
                    `· [${f.kind}] ${f.dept} ${f.person_label}: ${f.body}${f.resolution ? `\n    → ${f.resolution}` : '\n    → 아직 처리하지 않음'}`
                )
                .join('\n')}`
            : null,
        ])
      : block('[5] 베타테스트', ['아직 채점하지 않았습니다.'])
  )

  // ⑥ 사용법서
  out.push(
    manual
      ? block('[6] 사용법서 — 부서가 읽을 것', [
          line('제목', manual.title),
          line('이게 무엇인가', manual.intro),
          line('언제 돌리나', manual.when_to_run),
          line('결과를 받으면', manual.what_to_do_after),
          line('막히면', manual.contact),
          line('그 밖에', manual.notes),
          faqs.length > 0
            ? `자주 묻는 것 ${faqs.length}개\n${faqs.map((f) => `Q. ${f.question}\nA. ${f.answer}`).join('\n\n')}`
            : null,
          line('공개 시각', when(manual.published_at)),
        ])
      : block('[6] 사용법서', ['아직 쓰지 않았습니다.'])
  )

  // ⑦ 배포
  out.push(
    handover
      ? block('[7] 배포 — 부서에 넘김', [
          line('주소', `/t/${handover.slug}`),
          line('넘긴 곳', `${handover.handed_to_dept} ${handover.handed_to_person}`),
          line('넘긴 시각', when(handover.handed_at)),
          line(
            '부서가 받았다고 확인',
            handover.accepted_at
              ? `${when(handover.accepted_at)} · ${handover.accepted_by ?? ''}`
              : '아직 확인하지 않았습니다 — 넘겼다고 받은 것이 아닙니다'
          ),
          line('사용 한도', `하루 ${handover.daily_limit}회, 파일 ${handover.max_file_mb}MB`),
          handover.rolled_back_at
            ? `되돌림: ${when(handover.rolled_back_at)} — ${handover.rollback_reason ?? ''}`
            : null,
          uses.length > 0
            ? `넘긴 뒤 실제 사용 ${uses.length}회 (실패 ${uses.filter((u) => !u.ok).length}회)`
            : '넘긴 뒤 아직 한 번도 쓰이지 않았습니다.',
        ])
      : block('[7] 배포', ['아직 넘기지 않았습니다.'])
  )

  // ⑧ 성과
  const unresolved = challenges.filter((c) => !c.resolved_at)
  out.push(
    outcome
      ? block('[8] 성과 — 기준선과 대조', [
          line('만든 공수', `${outcome.dev_hours}시간 (${outcome.amortize_months}개월 상각)`),
          line('운영 비용', `${outcome.ops_cost_krw}원`),
          line(
            '부서 확인',
            outcome.dept_confirmed_at
              ? `${when(outcome.dept_confirmed_at)} · ${outcome.dept_confirmed_by ?? ''}${outcome.dept_comment ? ` — "${outcome.dept_comment}"` : ''}`
              : '아직 확인받지 못했습니다 — 만든 사람만 아는 성과는 성과가 아닙니다'
          ),
          line('이 과정에서 새로 찾은 병목', outcome.next_bottleneck),
          challenges.length > 0
            ? `자기 반박 ${challenges.length}건 (미해소 ${unresolved.length}건)\n${challenges
                .map(
                  (c) =>
                    `· [${c.resolved_at ? '해소' : '미해소'}] ${c.title}\n    ${c.body}${c.resolution ? `\n    → ${c.resolution}` : ''}`
                )
                .join('\n')}`
            : null,
          unresolved.length > 0
            ? `미해소 반박이 ${unresolved.length}건 남아 있어 이 금액은 '보수적 추정치'로 부릅니다.`
            : null,
        ])
      : block('[8] 성과', ['아직 정리하지 않았습니다.'])
  )

  // 결정 기록 — 전 단계를 관통한다.
  out.push(
    decisions.length > 0
      ? block(`[기록] 이 신청서에서 내린 결정 ${decisions.length}건`, [
          ...decisions.map((d) =>
            [
              `· ${when(d.created_at)} [${d.stage}] ${d.title}${d.unrequested ? ' *요청받지 않았으나 먼저 제안*' : ''}`,
              `    무엇을: ${d.what}`,
              `    왜: ${d.why}`,
              d.alternatives ? `    고르지 않은 길: ${d.alternatives}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          ),
        ])
      : null
  )

  out.push(
    [
      '='.repeat(60),
      '이 문서는 일손(ILSON)이 기록에서 그대로 뽑은 것입니다.',
      '빈 칸은 아직 하지 않은 일이고, 하지 않은 것을 한 것처럼 채우지 않습니다.',
    ].join('\n')
  )

  return out.filter(Boolean).join('\n\n')
}

function safeJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// 내려받을 때 붙일 파일 이름. 접수번호가 앞에 와야 정렬했을 때 모인다.
export function dossierFilename(app) {
  const safeTitle = String(app?.title ?? '신청서')
    .replace(/[\\/:*?"<>|]/g, '')
    .slice(0, 40)
    .trim()
  return `${app?.ticket_no ?? 'AX'} ${safeTitle}.txt`
}
