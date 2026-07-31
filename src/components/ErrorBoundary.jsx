import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <p>문제가 발생했습니다. 새로고침해주세요.</p>
          <button type="button" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
