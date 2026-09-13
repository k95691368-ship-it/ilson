// React 19가 act() 경계를 검사할 수 있도록 Vitest DOM 환경임을 밝힌다.
// 이 값이 없으면 검사가 통과해도 경고가 stderr에 쌓여 진짜 경고가 묻힌다.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
