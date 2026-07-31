import { Component } from 'react'

// 화면 어딘가에서 예상 못 한 오류가 나면 React는 기본적으로 전체를 지운다.
// 흰 화면만 남으면 보는 사람은 무엇이 잘못됐는지도, 무엇을 해야 하는지도 모른다.
// 그래서 여기서 붙잡아 사람이 읽을 수 있는 화면으로 바꾼다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="error-boundary">
        <h2>화면을 그리다 멈췄습니다</h2>
        <p>
          이 화면에서 예상하지 못한 문제가 생겼습니다. 새로고침하면 대개 다시 돌아옵니다.
          같은 자리에서 계속 멈춘다면 아래 내용을 알려주세요.
        </p>
        <pre>{String(this.state.error?.message ?? this.state.error)}</pre>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    )
  }
}
