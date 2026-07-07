import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// The offline/local build uses a relative base ('./'), which would make the router
// basename '/./' and match nothing. Only pass an absolute basename.
const base = import.meta.env.BASE_URL
const basename = base.startsWith('/') ? base : undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
