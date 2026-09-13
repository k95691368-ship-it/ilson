import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './redesign.css'
import './override.css'
import './apple-design.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import WorkspaceGate from './components/WorkspaceGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <WorkspaceGate><App /></WorkspaceGate>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
)
