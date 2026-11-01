import '@fontsource/anek-latin/600.css'
import '@fontsource/anek-latin/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { newQueryClient } from './api/query.ts'
import { App } from './App.tsx'
import { en } from './i18n/en.ts'

document.title = en.appName

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html is missing the #root element.')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={newQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
