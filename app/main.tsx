import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The library's own stylesheet first — it is all mechanism, and shadcn.css
// below is this app's answer to what it asks for.
import 'three-ui/style.css'
import './shadcn.css'
import './app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
