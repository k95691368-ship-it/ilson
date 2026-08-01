// 이미 들어와 있는 신청서를 또 내는 것을 잡는다.
//
// 실제로 일어난 일이다. "매주 채널 정산서를 손으로 붙입니다"가 두 건 들어와
// 있는데 하나는 이미 만들어서 넘긴 것이고 하나는 아직 접수함에 앉아 있다.
// 부서 사람이 바뀌었거나, 낸 사람이 잊었거나, 옆자리가 낸 걸 몰랐거나.
//
// 이게 왜 나쁜가. 부서는 이미 있는 도구를 못 쓰고 몇 주를 더 기다리고,
// 담당자는 같은 일을 두 번 검토한다. 둘 다 손해다.
//
// AI를 쓰지 않는다. 규칙으로 푼다. 낱말이 얼마나 겹치는지를 세고, **어느
// 낱말이 겹쳤는지를 함께 돌려준다.** 점수만 주면 "왜 비슷하다는 거지"에
// 답할 수 없고, 답할 수 없는 경고는 사람이 그냥 닫아 버린다.

// 어디에나 나오는 말. 이것까지 세면 아무 신청서나 서로 비슷해진다.
//
// "합니다"가 겹친다고 같은 병목이 아니다. 이 목록은 신청서 본문에서 실제로
// 자주 나오는 것을 보고 골랐다 — 병목·업무·시간처럼 뜻이 있어 보이지만
// 모든 신청서에 다 들어가는 말들이 특히 문제다.
const STOPWORDS = new Set([
  '합니다', '입니다', '있습니다', '없습니다', '됩니다', '해야', '하는', '하고', '해서',
  '그리고', '그런데', '하지만', '때문에', '위해', '위한', '대해', '대한',
  '이것', '그것', '저것', '여기', '거기', '무엇', '어떤', '이런', '그런',
  '매번', '다시', '직접', '전부', '모두', '각각', '보통', '거의', '정도',
  '업무', '작업', '일이', '것이', '것을', '수가', '수를', '경우', '상태',
  '사람', '담당', '담당자', '부서', '팀에서', '저희', '제가', '우리',
  '싶습니다', '주세요', '좋겠습니다', '바랍니다', '어렵습니다', '힘듭니다',
  'the', 'and', 'for', 'with',
])

// 붙어 다니는 조사. 낱말 끝에서 떼어 낸다.
//
// 형태소 분석기를 쓰지 않는 이유는 이 사이트가 외부 것을 아무것도 안 부르기
// 때문이다. 조사 몇 개를 떼는 것만으로도 "정산서를"과 "정산서가"가 같은
// 낱말이 되고, 그 정도면 신청서 두 건이 같은 얘기인지 가리는 데 충분하다.
const PARTICLES = [
  '으로는', '에서는', '에게는', '까지도', '부터는',
  '으로', '에서', '에게', '까지', '부터', '보다', '처럼', '마다', '조차', '라도',
  '이나', '이란', '이라', '와의', '과의', '들을', '들이', '들은',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '과', '와', '로', '랑',
]

// 서술어 어미. "확인합니다"에서 "확인"만 남긴다.
//
// 이게 없으면 "확인합니다"가 확인·인합·합니·니다 네 조각을 만들고, 그중
// 합니·니다는 모든 신청서에 다 들어 있는 껍데기다. 껍데기끼리 겹쳐서
// 전혀 다른 두 병목이 비슷하다고 나온다. 실제로 시험에서 잡혔다.
const ENDINGS = [
  '했습니다', '됐습니다', '시킵니다', '드립니다', '옮깁니다',
  '합니다', '입니다', '됩니다', '습니다', '합니까', '주세요',
  '하는', '해서', '하고', '한다', '된다', '하기', '되기', '하면', '되면', '려면',
  '으면', '이며', '면',
]

// 목록으로 다 적을 수 없는 어미들.
//
// "지나갑니다"·"늦어집니다"·"올라옵니다"를 하나씩 적어 두는 것은 끝이 없다.
// 한국어 서술어는 "…앞 글자 + 니다"로 끝나는 꼴이 압도적이라 그 모양을
// 통째로 떼는 편이 낫다. "나왔는데"·"많았는데" 같은 연결어미도 마찬가지다.
//
// 이걸 안 하면 "지나갑니다"가 남아서, 왜 비슷하냐고 물었을 때 "지나갑니다가
// 겹칩니다"라고 답하게 된다. 그런 답을 들으면 사람은 그 경고를 안 믿는다.
const ENDING_SHAPES = [
  /[가-힣]니다$/, // 합니다 갑니다 집니다 옵니다 …
  /(었|았|였)는데$/,
  /는데$/,
  /(어|아|여)서$/,
  /(으로|이라)고$/,
]

function stripTail(word, list) {
  for (const t of list) {
    // 떼고 나서도 두 글자는 남아야 한다. "화면"에서 "면"을 떼면 "화" 하나만
    // 남아 아무 뜻이 없어진다.
    if (!word.endsWith(t)) continue
    // 그리고 여기서 멈춘다. 긴 것부터 보고 있으므로 지금 걸린 것이 맞는
    // 분석이다. 짧은 것으로 계속 내려가면 "손으로"에서 "으로"를 못 떼고
    // 대신 "로"를 떼서 "손으"라는 없는 말이 된다.
    return word.length > t.length + 1 ? word.slice(0, -t.length) : word
  }
  return word
}

function stripShape(word) {
  for (const re of ENDING_SHAPES) {
    const cut = word.replace(re, '')
    if (cut.length >= 2 && cut.length < word.length) return cut
  }
  return word
}

function normalizeWord(word) {
  if (word.length <= 2) return word
  return stripTail(stripTail(stripShape(word), ENDINGS), PARTICLES)
}

const HANGUL = /[가-힣]/

// 낱말을 뽑되 온전한 낱말과 조각을 나눠서 돌려준다.
//
// 한글 낱말은 글자 두 개짜리 조각으로도 쪼개 둔다. "정산서"와 "정산 내역"이
// 서로 걸리게 하려면 이게 필요하다 — 띄어쓰기와 조사가 제각각이라 낱말을
// 통째로만 견주면 거의 안 겹친다.
//
// 견줄 때는 둘 다 쓴다. 조각이 없으면 "정산서"와 "정산 내역"이 안 걸린다.
// 그런데 사람에게 왜 비슷한지 말할 때는 온전한 낱말만 쓴다. "손으·산서·니다가
// 겹칩니다"는 아무 말도 안 한 것이고, "정산서·채널·엑셀이 겹칩니다"는 그
// 자리에서 맞는지 틀린지 판단하게 해 준다.
export function tokenParts(text) {
  const raw = String(text ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const all = new Set()
  const words = new Set()
  for (const word0 of raw) {
    const word = normalizeWord(word0)
    if (word.length < 2) continue
    if (STOPWORDS.has(word) || STOPWORDS.has(word0)) continue
    all.add(word)
    words.add(word)

    if (HANGUL.test(word) && word.length >= 3) {
      for (let i = 0; i + 2 <= word.length; i++) {
        all.add(word.slice(i, i + 2))
      }
    }
  }
  return { all, words }
}

export function tokenize(text) {
  return tokenParts(text).all
}

// 낱말마다 무게를 다르게 준다.
//
// 껍데기를 아무리 떼어 내도 "매주"·"확인"처럼 뜻은 있는데 모든 신청서에
// 다 나오는 말이 남는다. 그런 말이 겹친다고 같은 병목이 아니다. 반대로
// "정산서"나 "소진일"처럼 몇 건에만 나오는 말이 겹치면 그건 거의 같은 일이다.
//
// 그래서 이미 들어와 있는 신청서 전부를 훑어서, 여러 건에 나오는 말일수록
// 가볍게 친다. 목록을 미리 정해 두지 않고 실제 데이터가 정하게 하는 것이라
// 회사마다 쓰는 말이 달라도 알아서 맞는다.
export function corpusOf(items) {
  const df = new Map()
  const list = items ?? []
  for (const it of list) {
    const seen = new Set()
    for (const field of Object.keys(FIELD_WEIGHT)) {
      for (const t of tokenParts(it?.[field]).all) seen.add(t)
    }
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
  }
  return { df, n: list.length }
}

// 신청서가 몇 건은 쌓여야 "흔한 말"이 뭔지 알 수 있다. 세 건으로는
// 못 가린다 — 그때는 모든 낱말을 똑같이 센다. 표본이 적으면 적은 대로
// 하는 것이지, 적은 표본에서 억지로 짜내지 않는다.
const MIN_CORPUS = 4

function weightOf(token, corpus) {
  if (!corpus || corpus.n < MIN_CORPUS) return 1
  const d = corpus.df.get(token) ?? 0
  // 모든 신청서에 다 나오면 0에 가깝고, 한 건에만 나오면 1에 가깝다.
  return Math.log((corpus.n + 1) / (d + 1)) / Math.log(corpus.n + 1)
}

// 겹친 무게가 이만큼은 돼야 "비슷하다"고 말할 근거가 선다.
//
// 이게 없으면 짧은 쪽 낱말이 **전부** 겹칠 때 무게를 아무리 잘 매겨도
// 점수가 1이 된다. 나누는 값과 나뉘는 값이 같아져서 무게가 지워지기
// 때문이다. 실제로 "틀리면 다시 합니다"끼리 견주면 그렇게 된다 — 겹치긴
// 다 겹쳤는데 겹친 것이 전부 껍데기라 아무 말도 안 한 셈이다.
//
// 그래서 비율만 보지 않고 절대량에도 바닥을 깐다. 대략 "뜻이 뚜렷한 낱말
// 하나만큼은 겹쳐야 한다"는 뜻이다.
const MIN_EVIDENCE = 1

// 두 낱말 뭉치가 얼마나 겹치나.
//
// 자카드(교집합÷합집합)를 쓰지 않는다. 신청서는 길이가 제각각이라, 긴 글
// 하나와 짧은 글 하나를 견주면 합집합이 커져서 점수가 부당하게 낮아진다.
// 짧은 쪽 기준으로 나눈다 — "짧은 쪽이 하는 말이 긴 쪽에 다 들어 있나"를
// 묻는 것이 우리가 알고 싶은 것이다.
function overlap(a, b, corpus) {
  if (a.all.size === 0 || b.all.size === 0) return { score: 0, shared: [] }
  const [small, big] = a.all.size <= b.all.size ? [a, b] : [b, a]

  let hit = 0
  let all = 0
  const shared = []
  for (const t of small.all) {
    const w = weightOf(t, corpus)
    all += w
    if (big.all.has(t)) {
      hit += w
      // 양쪽 다 온전한 낱말로 가지고 있는 것만 '낱말'로 친다. 한쪽에서만
      // 통째로 나온 것은 다른 쪽에선 큰 낱말의 조각일 뿐이다.
      shared.push({ token: t, weight: w, isWord: small.words.has(t) && big.words.has(t) })
    }
  }
  return { score: hit / Math.max(all, MIN_EVIDENCE), shared }
}

// 어느 칸이 겹치는 것이 더 중한가.
//
// 제목이 겹치는 것이 가장 세다. 사람은 제목에 그 일의 핵심을 적는다.
// 문제(그래서 무슨 일이 생기나)는 가장 약하다 — "숫자가 틀립니다"는
// 서로 다른 병목에서도 똑같이 나온다.
const FIELD_WEIGHT = { title: 3, bottleneck: 2, problem: 1 }

// 같은 부서에서 왔으면 더 의심한다.
//
// 다른 부서가 비슷한 말을 쓰는 것은 흔하다. 재무의 '정산'과 영업의 '정산'은
// 다른 일일 수 있다. 그런데 같은 부서에서 비슷한 말이 두 번 나오면 그건
// 대개 같은 일이다.
const SAME_DEPT_BONUS = 0.12

// 이 점수부터 "비슷하다"고 본다.
//
// 낮게 잡으면 아무 때나 경고가 떠서 아무도 안 읽고, 높게 잡으면 진짜
// 중복을 놓친다. 0.34는 대략 "짧은 쪽 낱말의 3분의 1이 겹친다"는 뜻이다.
export const SIMILAR_THRESHOLD = 0.34

// 이만큼이면 거의 확실히 같은 건이다. 화면에서 더 세게 말한다.
export const SAME_THRESHOLD = 0.55

export function similarity(draft, other, corpus) {
  let weighted = 0
  let totalWeight = 0
  const all = []

  for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
    const a = tokenParts(draft?.[field])
    const b = tokenParts(other?.[field])
    // 한쪽이 비어 있으면 그 칸은 아예 안 센다. 0점으로 치면 아직 다 적지
    // 않은 신청서가 무조건 안 비슷한 것으로 나온다.
    if (a.all.size === 0 || b.all.size === 0) continue
    const { score, shared } = overlap(a, b, corpus)
    weighted += score * weight
    totalWeight += weight
    all.push(...shared)
  }

  if (totalWeight === 0) return { score: 0, shared: [] }

  let score = weighted / totalWeight
  if (draft?.dept && other?.dept && draft.dept === other.dept) {
    score = Math.min(1, score + SAME_DEPT_BONUS)
  }

  // 화면에 보여 줄 겹친 말.
  //
  // 드문 말부터 보여 준다. "정산서·소진일"이 겹쳤다고 해야 사람이 납득하지,
  // "매주·확인"이 겹쳤다고 하면 그 경고를 바로 닫는다. 같은 무게면 긴 것이
  // 먼저다 — "정산서"가 "정산"보다 할 말이 많다.
  const best = new Map()
  for (const s of all) {
    const prev = best.get(s.token)
    if (!prev || prev.weight < s.weight) best.set(s.token, s)
  }

  // 온전한 낱말을 먼저, 그 안에서 드문 것을 먼저.
  //
  // 조각("손으"·"산서"·"니다")이 앞에 오면 사람이 이 경고를 안 믿는다.
  // 조각은 견줄 때만 쓰고 말할 때는 뒤로 미룬다.
  const ranked = [...best.values()].sort(
    (x, y) =>
      Number(y.isWord) - Number(x.isWord) ||
      y.weight - x.weight ||
      y.token.length - x.token.length ||
      x.token.localeCompare(y.token, 'ko')
  )

  // 이미 고른 낱말 안에 들어 있는 조각은 뺀다. "정산서"를 보여 주면서
  // "정산"과 "산서"를 또 보여 줄 이유가 없다.
  const shared = []
  for (const r of ranked) {
    if (shared.some((k) => k.includes(r.token))) continue
    shared.push(r.token)
    if (shared.length >= 8) break
  }

  return { score, shared }
}

// 비슷한 것을 찾아 점수 순으로.
//
// 무게를 재는 기준(corpus)은 이미 들어와 있는 신청서 전부에서 뽑는다.
// 지금 적고 있는 것은 넣지 않는다 — 아직 접수된 것이 아니라서 "이 말이
// 회사에서 얼마나 흔한가"의 근거가 될 수 없다.
export function findSimilar(draft, others, { threshold = SIMILAR_THRESHOLD, limit = 3 } = {}) {
  const list = others ?? []
  const corpus = corpusOf(list)
  const hits = []
  for (const other of list) {
    // 자기 자신은 뺀다. 검토 화면에서 쓸 때 필요하다.
    if (draft?.id && other?.id === draft.id) continue
    const { score, shared } = similarity(draft, other, corpus)
    if (score >= threshold) hits.push({ ...other, score, shared, same: score >= SAME_THRESHOLD })
  }
  hits.sort((a, b) => b.score - a.score || String(a.created_at).localeCompare(String(b.created_at)))
  return hits.slice(0, limit)
}

// 왜 비슷하다고 봤는지 한 줄로.
//
// 점수만 보여 주면 "0.62가 뭔데"가 된다. 겹친 말을 그대로 보여 주는 편이
// 훨씬 낫다 — 사람이 그 자리에서 맞는지 틀린지 판단할 수 있다.
export function reasonText(hit) {
  if (!hit?.shared?.length) return '적어 주신 내용이 전체적으로 비슷합니다.'
  return `${hit.shared.slice(0, 5).join(' · ')} 같은 말이 겹칩니다.`
}
