import { cloneElement, isValidElement, useId } from 'react'

// 입력 이름, 필수 여부, 도움말, 오류를 한 번에 연결한다.
// 화면마다 같은 모양의 Field를 따로 만들면 시각은 비슷해도 보조기기에
// 전달되는 정보가 달라진다. 이 컴포넌트가 실제 required/aria 속성까지 맡는다.
export default function Field({ label, required = false, hint, error, count, children }) {
  const uid = useId().replaceAll(':', '')
  const controlId = children?.props?.id ?? `field-${uid}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const countId = count ? `${controlId}-count` : undefined
  const describedBy = [children?.props?.['aria-describedby'], hintId, errorId, countId]
    .filter(Boolean)
    .join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        required: required || children.props.required || undefined,
        'aria-required': required || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label className="field-label" htmlFor={controlId}>
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (필수)</span>}
        {hint && <span className="field-hint" id={hintId}>{hint}</span>}
      </label>
      {control}
      {(error || count) && (
        <span className="field-foot">
          {error && <span className="field-error" id={errorId} role="alert">{error}</span>}
          {count && (
            <span className="field-count" id={countId}>
              {count[0]}/{count[1]}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
