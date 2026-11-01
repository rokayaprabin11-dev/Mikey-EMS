import '@fontsource/anek-latin/600.css'
import '@fontsource/anek-latin/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import type { StartAt } from '../electron/bridge.ts'
import { newQueryClient } from './api/query.ts'
import { App } from './App.tsx'
import { CrashScreen } from './components/CrashScreen.tsx'
import { en } from './i18n/en.ts'
import { Splash } from './startup/Splash.tsx'

document.title = en.appName

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html is missing the #root element.')
}

// The main process says which window this is (electron/main/index.ts).
const query = new URLSearchParams(window.location.search)
const START_AT: readonly StartAt[] = ['setup', 'get-allowed', 'sign-in']
const startAt = START_AT.find((value) => value === query.get('startAt')) ?? 'setup'

createRoot(rootElement).render(
  <StrictMode>
    <CrashScreen>
      <QueryClientProvider client={newQueryClient()}>
        {query.get('view') === 'splash' ? <Splash /> : <App startAt={startAt} />}
      </QueryClientProvider>
    </CrashScreen>
  </StrictMode>,
)
