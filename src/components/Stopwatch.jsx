import { useEffect, useRef, useState } from 'react'
import { duration } from '../lib/format.js'

// 기준선을 재는 스톱워치.
//
// 이게 이 프로젝트에서 제일 단순한 코드인데, 하는 일은 제일 중요하다.
// 8단계에서 "97분이 3분이 됐습니다"라고 말하려면 그 97분이 어디서 왔는지
// 답할 수 있어야 하는데, 만들고 나서 기억으로 적은 숫자로는 답이 안 된다.
// 그래서 자동화하기 전에, 담당자 옆에서 시작 버튼을 누르고 끝나면 정지를
// 누른다. 그 값만 기준선이 된다.
//
// 시간을 셀 때 setInterval로 1씩 더하지 않는다. 브라우저가 다른 탭에 가 있거나
// 화면이 잠기면 그 사이 타이머가 느려져 실제보다 짧게 잰다. 시작 시각을 붙잡아
// 두고 매번 '지금 − 시작'을 다시 계산하면 그런 일이 없다.
export default function Stopwatch({ onDone, disabled }) {
  const [startedAt, setStartedAt] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [errors, setErrors] = useState(0)
  const [note, setNote] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    if (startedAt == null) return undefined
    timer.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250)
    return () => clearInterval(timer.current)
  }, [startedAt])

  const running = startedAt != null

  function start() {
    setElapsed(0)
    setStartedAt(Date.now())
  }

  function stop() {
    const seconds = (Date.now() - startedAt) / 1000
    clearInterval(timer.current)
    setStartedAt(null)
    setElapsed(seconds)
    onDone({ total_seconds: seconds, error_count: errors, note: note.trim() || null })
    setErrors(0)
    setNote('')
  }

  return (
    <div className={`stopwatch${running ? ' running' : ''}`}>
      <div className="stopwatch-time" aria-live="off">
        {formatClock(elapsed)}
      </div>

      {running ? (
        <>
          <p className="card-note">
            지금 재고 있습니다. 담당자가 그 일을 실제로 하는 동안 그대로 두세요.
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setErrors((n) => n + 1)}>
              실수 +1 <strong>({errors})</strong>
            </button>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="특이사항 (선택)"
              style={{ flex: 1, minWidth: 160 }}
            />
          </div>
          <button type="button" className="btn-primary btn-block" onClick={stop} style={{ marginTop: 10 }}>
            끝났습니다 — 기록하기
          </button>
        </>
      ) : (
        <>
          <p className="card-note">
            담당자가 그 일을 시작할 때 누르세요. 중간에 실수가 나오면 세어 두었다가 함께 기록합니다.
          </p>
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={start}
            disabled={disabled}
            style={{ marginTop: 10 }}
          >
            지금부터 재기
          </button>
        </>
      )}

      {!running && elapsed > 0 && (
        <p className="card-note" style={{ marginTop: 8 }}>
          방금 {duration(elapsed)} 기록했습니다.
        </p>
      )}
    </div>
  )
}

function formatClock(seconds) {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
