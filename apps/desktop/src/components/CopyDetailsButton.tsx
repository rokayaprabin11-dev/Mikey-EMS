import { useEffect, useState } from 'react'

import { en } from '../i18n/en.ts'
import { Button } from './ui/button.tsx'

const COPIED_MS = 2_000

// Copies the technical details of a problem for whoever looks after the computers, and says
// "Copied" for a moment.
export function CopyDetailsButton({ details, className }: { details: () => string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      variant="secondary"
      className={className}
      onClick={() => void navigator.clipboard.writeText(details()).then(() => setCopied(true))}
    >
      {copied ? en.copied : en.copyDetails}
    </Button>
  )
}
