import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/workflows.css'
import './styles/records.css'
import './styles/operations.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import WorkspaceGate from './components/WorkspaceGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <WorkspaceGate><ToastProvider><App /></ToastProvider></WorkspaceGate>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
