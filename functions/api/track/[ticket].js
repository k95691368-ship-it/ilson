// 접수번호로 내 신청서가 어디까지 왔는지 본다.
//
// 신청서를 내면 접수번호를 주는데 그걸로 볼 데가 없었다. 부서 담당자는
// 자기가 낸 것이 어떻게 됐는지 알 방법이 없어서 결국 담당자에게 전화한다.
// 그 전화를 없애는 화면이다.
//
// 로그인이 없다. 접수번호를 아는 사람이 그 신청서의 주인이라고 본다.
// 그래서 남의 신청서를 훑을 수 없게 두 가지를 지킨다 —
//   1) 목록을 주지 않는다. 정확한 접수번호를 알아야만 한 건이 나온다.
//   2) 접수번호를 찍어 맞히는 것을 막으려고 호출 횟수를 제한한다.
//      (번호는 헷갈리는 글자를 뺀 31글자 중 6자리라 887억 가지다)

import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { annualHours } from '../../_lib/applications.js'
import { REFUSE_REASONS } from '../../../shared/review.js'
import { RESUBMIT_KIND, RESUBMIT_BACK_KIND } from '../../../shared/resubmit.js'
import { SIGNOFF_KIND } from '../../../shared/signoff.js'

// 기록이 다른 신청서를 가리키고 있으면 그 접수번호를 붙여 준다.
//
// link_id는 내부 id라 부서에게는 아무 뜻이 없다. 이걸 안 붙이면 화면은
// 기록 본문에서 접수번호를 글자로 뽑아 쓰게 되는데, 문구를 한 번 고치는
// 날 조용히 끊긴다.
async function withLinkedTickets(env, rows) {
  const linked = [RESUBMIT_KIND, RESUBMIT_BACK_KIND]
  const ids = [...new Set(rows.filter((d) => linked.includes(d.link_kind)).map((d) => d.link_id))]
  if (ids.length === 0) return rows

  const { results } = await env.DB.prepare(
    `SELECT id, ticket_no FROM application WHERE id IN (${ids.map(() => '?').join(',')})`
  )
    .bind(...ids)
    .all()
  const byId = new Map(results.map((r) => [r.id, r.ticket_no]))

  // 상대 신청서가 지워졌으면 null이 그대로 간다. 화면은 그때 링크를 안
  // 건다 — 없는 데로 보내는 버튼보다 버튼이 없는 편이 낫다.
  return rows.map((d) =>
    linked.includes(d.link_kind) ? { ...d, link_ticket: byId.get(d.link_id) ?? null } : d
  )
}

const STAGES = [
  '신청서',
  '검토',
  '협의안',
  '제작',
  '베타테스트',
  '사용법서',
  '배포',
  '성과',
]

export async function onRequestGet({ env, params, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ticket = String(params.ticket ?? '').trim().toUpperCase()

  // 번호를 찍어 맞히려는 시도를 막는다. 자기 번호를 확인하는 사람에게는
  // 넉넉한 값이다.
  const ok = await checkRateLimit(env, `track:${ip}`, 30, 600)
  if (!ok) {
    return jsonError('조회가 너무 잦습니다. 10분 뒤에 다시 시도해주세요.', 429)
  }

  if (!/^AX-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(ticket)) {
    return jsonError('접수번호 모양이 맞지 않습니다. AX-000-000 형태로 적어주세요.', 400)
  }

  try {
    const app = await env.DB.prepare('SELECT * FROM application WHERE ticket_no = ?')
      .bind(ticket)
      .first()

    if (!app) {
      return jsonError('그 접수번호로 낸 신청서를 찾지 못했습니다. 번호를 다시 확인해주세요.', 404)
    }

    const [review, files, meetings, reqs, criteria, baseline, builds, beta, manual, handover, uses, outcome, decisions, feedbackCount] =
      await Promise.all([
        env.DB.prepare('SELECT * FROM review WHERE application_id = ?').bind(app.id).first(),
        env.DB.prepare('SELECT id, name, byte_size FROM application_file WHERE application_id = ?')
          .bind(app.id)
          .all(),
        env.DB.prepare(
          "SELECT COUNT(*) AS n FROM meeting WHERE application_id = ? AND status = '완료'"
        )
          .bind(app.id)
          .first(),
        env.DB.prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('채택','수정채택') THEN 1 ELSE 0 END) AS taken,
                  SUM(CASE WHEN status = '기각' THEN 1 ELSE 0 END) AS rejected
           FROM requirement WHERE application_id = ?`
        )
          .bind(app.id)
          .first(),
        env.DB.prepare(
          `SELECT COUNT(*) AS n,
                  SUM(CASE WHEN confirmed_at IS NULL THEN 0 ELSE 1 END) AS confirmed
           FROM acceptance_criterion WHERE application_id = ?`
        )
          .bind(app.id)
          .first(),
        env.DB.prepare('SELECT median_seconds, sample_n, sealed_at FROM baseline WHERE application_id = ?')
          .bind(app.id)
          .first(),
        env.DB.prepare(
          'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM build_run WHERE application_id = ?'
        )
          .bind(app.id)
          .first(),
        env.DB.prepare(
          'SELECT seq, overall, passed, failed, created_at FROM beta_round WHERE application_id = ? ORDER BY seq DESC LIMIT 1'
        )
          .bind(app.id)
          .first(),
        env.DB.prepare('SELECT published_at, contact FROM manual WHERE application_id = ?')
          .bind(app.id)
          .first(),
        env.DB.prepare('SELECT slug, handed_to_person, handed_at, accepted_at, rolled_back_at FROM handover WHERE application_id = ?')
          .bind(app.id)
          .first(),
        env.DB.prepare('SELECT COUNT(*) AS n, MAX(used_at) AS last FROM tool_use WHERE application_id = ?')
          .bind(app.id)
          .first(),
        env.DB.prepare('SELECT dept_confirmed_at FROM outcome WHERE application_id = ?')
          .bind(app.id)
          .first(),
        // 신청자에게 보여 줄 결정만 고른다. 내부 메모까지 다 보여 주지는 않는다.
        //
        // id와 link_kind를 같이 준다. 담당자가 되물은 것을 부서가 보고
        // 답하려면, 어느 것이 질문이고 그 질문이 무엇인지 가릴 수 있어야 한다.
        env.DB.prepare(
          `SELECT id, stage, title, what, why, link_kind, link_id, created_at FROM decision_log
           WHERE application_id = ? AND actor = 'human'
           ORDER BY created_at`
        )
          .bind(app.id)
          .all(),
        // 이 부서가 시험판을 써 보고 남긴 말이 있는가. 없으면 기계 채점만
        // 통과한 상태고, 그것만으로는 쓸 만한지 알 수 없다.
        env.DB.prepare('SELECT COUNT(*) AS n FROM beta_feedback WHERE application_id = ?')
          .bind(app.id)
          .first(),
      ])

    const refuseReason = review?.refuse_code
      ? REFUSE_REASONS.find((r) => r.code === review.refuse_code)
      : null

    // 단계별 상태: 완료 / 진행중 / 대기 / 해당없음
    const done = (v) => (v ? '완료' : '대기')
    const timeline = [
      {
        stage: '신청서',
        status: '완료',
        at: app.created_at,
        summary: `${app.dept}에서 냈습니다. 첨부 ${files.results.length}개.`,
      },
      {
        stage: '검토',
        status: review ? '완료' : app.status === '접수' ? '대기' : '진행중',
        at: review?.decided_at ?? null,
        summary: review
          ? review.verdict === '반려'
            ? `반려했습니다 — ${refuseReason?.label ?? '범위 밖'}`
            : review.verdict === '보류'
              ? '보류했습니다'
              : `수용했습니다 (임팩트 ${review.impact_score} / 난이도 ${review.difficulty_score})`
          : '담당자가 아직 열람하지 않았습니다.',
        detail: review
          ? {
              판정_이유: review.verdict_reason || null,
              대안: review.refuse_alternative || null,
              다시_볼_조건: review.hold_until_condition || null,
            }
          : null,
      },
      {
        stage: '협의안',
        status: baseline ? '완료' : (meetings?.n ?? 0) > 0 ? '진행중' : '대기',
        at: baseline?.sealed_at ?? null,
        summary:
          (meetings?.n ?? 0) > 0
            ? `회의 ${meetings.n}번 · 요구 ${reqs?.total ?? 0}건 중 ${reqs?.taken ?? 0}건 채택${
                (reqs?.rejected ?? 0) > 0 ? `, ${reqs.rejected}건 기각` : ''
              } · 합격 기준 ${criteria?.confirmed ?? 0}개 확정${
                baseline
                  ? ` · 실제로 재 보니 ${Math.round(baseline.median_seconds / 60)}분 걸렸습니다(${baseline.sample_n}회 측정)`
                  : ''
              }`
            : '아직 회의를 하지 않았습니다.',
      },
      {
        stage: '제작',
        // **완료로 갈 길이 없었다.**
        //
        // `만든 적 있으면 진행중, 아니면 대기` 둘뿐이라, 한 번이라도 만든
        // 신청서는 배포가 끝나고 성과가 쌓여도 영영 "제작 중"으로 남았다.
        // 그래서 여덟 단계 중 셋이 동시에 진행중이 되고, 상단 한 줄은
        // "지금 성과 단계까지 왔습니다"라고 하는데 그 위에 제작이 진행중으로
        // 떠 있었다. 부서 사람은 둘 중 하나가 거짓말이라고 읽는다.
        //
        // 다음 단계로 넘어갔으면 만들기는 끝난 것이다.
        status:
          beta || manual?.published_at || handover
            ? '완료'
            : (builds?.n ?? 0) > 0
              ? '진행중'
              : '대기',
        at: builds?.last ?? null,
        summary: (builds?.n ?? 0) > 0 ? `${builds.n}번 만들어 봤습니다.` : '아직 만들지 않았습니다.',
      },
      {
        stage: '베타테스트',
        status: beta?.overall === '통과' ? '완료' : beta ? '진행중' : '대기',
        at: beta?.created_at ?? null,
        summary: beta
          ? `${beta.seq}차 시험 — ${beta.overall} (통과 ${beta.passed}, 실패 ${beta.failed})`
          : '아직 시험하지 않았습니다.',
      },
      {
        stage: '사용법서',
        status: done(manual?.published_at),
        at: manual?.published_at ?? null,
        summary: manual?.published_at ? '사용법서를 썼습니다.' : '아직 쓰지 않았습니다.',
      },
      {
        stage: '배포',
        status: handover?.rolled_back_at
          ? '되돌림'
          : handover?.accepted_at
            ? '완료'
            : handover
              ? '진행중'
              : '대기',
        at: handover?.handed_at ?? null,
        summary: handover
          ? handover.rolled_back_at
            ? '문제가 있어 잠시 내렸습니다.'
            : `${handover.handed_to_person}에게 넘겼습니다.${
                handover.accepted_at ? ' 받았다고 확인해 주셨습니다.' : ' 아직 받았다는 확인이 없습니다.'
              }`
          : '아직 넘기지 않았습니다.',
        link: handover && !handover.rolled_back_at ? `/t/${handover.slug}` : null,
      },
      {
        stage: '성과',
        // 성과는 계속 쌓이는 것이라 '진행중'이라고 하면 아직 뭔가 만들고
        // 있는 것처럼 읽힌다. 넘긴 뒤로는 쓰이는 만큼 숫자가 붙을 뿐이다.
        status: outcome?.dept_confirmed_at ? '완료' : (uses?.n ?? 0) > 0 ? '집계 중' : '대기',
        at: outcome?.dept_confirmed_at ?? null,
        summary:
          (uses?.n ?? 0) > 0
            ? `넘긴 뒤 ${uses.n}번 쓰였습니다.${outcome?.dept_confirmed_at ? ' 성과를 확인해 주셨습니다.' : ''}`
            : '아직 쓰인 기록이 없습니다.',
      },
    ]

    // 지금 어디에 있는가.
    //
    // 예전에는 "대기가 아닌 가장 마지막 단계"를 집었다. 그러면 앞 단계가
    // 안 끝났는데도 끝 단계 이름이 상단에 뜬다 — 부서 사람이 이 화면에
    // 들어와 묻는 질문("내 거 지금 어디 있나요")에 답이 안 된다.
    //
    // 아직 안 끝난 첫 단계가 답이다. 그게 지금 멈춰 있는 자리다.
    const stuckAt = timeline.findIndex((t) => t.status !== '완료' && t.status !== '되돌림')
    const currentIndex = stuckAt >= 0 ? stuckAt : timeline.length - 1
    const doneCount = timeline.filter((t) => t.status === '완료').length

    // 지금 이 부서가 움직여야 진행되는 것.
    //
    // 조회 화면이 "어디까지 왔는지"만 보여 주면, 정작 멈춰 있는 이유가
    // 부서 쪽에 있을 때 아무도 모른다. 넘겨줬는데 확인이 없어서 멈춘 것과
    // 아직 안 만들어서 멈춘 것은 다른 일인데 화면에서는 똑같아 보인다.
    const needs = []

    if (review?.verdict === '보류' && review.hold_until_condition) {
      needs.push({ code: 'hold_condition', body: review.hold_until_condition })
    }
    if (review?.verdict === '반려' && review.refuse_alternative) {
      needs.push({ code: 'refused_alternative', body: review.refuse_alternative })
    }
    // 시험을 돌렸는데 아직 현업 의견이 한 건도 없다. 기계 채점만으로는
    // 쓸 만한지 알 수 없다.
    if (beta && (feedbackCount?.n ?? 0) === 0) {
      needs.push({ code: 'beta_feedback' })
    }
    if (handover && !handover.accepted_at && !handover.rolled_back_at) {
      needs.push({ code: 'handover_unconfirmed', link: `/t/${handover.slug}` })
    }
    if (outcome && !outcome.dept_confirmed_at && (uses?.n ?? 0) > 0) {
      needs.push({ code: 'outcome_unconfirmed' })
    }

    // 합격 기준이 전부 확정됐는데 부서가 아직 안 본 상태.
    //
    // 이걸 안 물으면 5단계에서 "합격 기준을 통과했습니다"라고 말하게 되는데,
    // 그 기준을 부서는 한 번도 본 적이 없다.
    const criteriaTotal = criteria?.n ?? 0
    const criteriaConfirmed = criteria?.confirmed ?? 0
    const signed = decisions.results.some((d) => d.link_kind === SIGNOFF_KIND)
    if (criteriaTotal > 0 && criteriaConfirmed === criteriaTotal && !signed) {
      needs.push({ code: 'criteria_signoff', body: `${criteriaTotal}개 항목입니다.` })
    }

    return jsonResponse({
      ticket: app.ticket_no,
      application: {
        dept: app.dept,
        applicant: app.applicant_label,
        title: app.title,
        bottleneck: app.bottleneck,
        problem: app.problem,
        wish: app.wish,
        created_at: app.created_at,
        status: app.status,
        claimed_minutes: app.current_minutes,
        claimed_frequency: app.current_frequency,
        annual_hours: annualHours(app),
      },
      files: files.results,
      timeline,
      stages: STAGES,
      currentStage: currentIndex >= 0 ? timeline[currentIndex].stage : '신청서',
      // 몇 단계가 끝났는지 같이 준다. 단계 이름만으로는 "많이 왔나 적게
      // 왔나"를 모른다.
      stageProgress: { done: doneCount, total: timeline.length },
      // 재신청으로 이어진 기록에는 상대 접수번호를 붙여 준다.
      //
      // link_id는 내부 id라 부서에게는 아무 뜻이 없다. 화면에서 "그 신청서
      // 보기"를 누르려면 접수번호가 있어야 하는데, 그것을 기록 본문에서
      // 글자로 뽑아 쓰면 문구를 한 번 고치는 날 조용히 끊긴다.
      decisions: await withLinkedTickets(env, decisions.results),
      // 다른 신청서와 같은 건으로 묶였으면 그것부터 알려야 한다.
      // 부서 입장에서 가장 중요한 소식이다 — 모르면 이미 만들고 있는 것을
      // 두고 몇 주를 기다린다.
      mergedInto: await (async () => {
        // 푼 것은 빼고 본다. 풀었는데도 "묶였습니다"가 계속 뜨면
        // 부서는 두 번 헷갈린다.
        const undone = new Set(
          decisions.results.filter((d) => d.link_kind === '병합해제').map((d) => d.link_id)
        )
        const m = decisions.results.find((d) => d.link_kind === '병합' && !undone.has(d.id))
        if (!m) return null
        const into = await env.DB.prepare(
          'SELECT ticket_no, dept, title, status FROM application WHERE id = ?'
        )
          .bind(m.link_id)
          .first()
        return into ? { ...into, why: m.why, at: m.created_at } : null
      })(),
      contact: manual?.contact ?? null,
      needs,
    })
  } catch (err) {
    return jsonError(`조회하지 못했습니다. (${String(err.message).slice(0, 160)})`, 503)
  }
}
