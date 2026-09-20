import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './redesign.css'
import './override.css'
import './microsoft-design.css'
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
