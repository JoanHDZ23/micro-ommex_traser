import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { getCompanyId } from './lib/context'

// Initialize context (captures companyId from URL before router changes it)
getCompanyId()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
