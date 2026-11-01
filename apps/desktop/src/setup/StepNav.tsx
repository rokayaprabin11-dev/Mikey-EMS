import { Button } from '../components/ui/button.tsx'
import { en } from '../i18n/en.ts'

const words = en.setup

// Back and Continue at the foot of each step.
export function StepNav({
  onBack,
  onContinue,
  canContinue = true,
  label = words.continue,
}: {
  onBack?: () => void
  onContinue: () => void
  canContinue?: boolean
  label?: string
}) {
  return (
    <div className="flex justify-between gap-2.5 border-t border-line pt-4.5">
      <Button variant="secondary" className="h-11.5 px-4.5" disabled={onBack === undefined} onClick={onBack}>
        {words.back}
      </Button>
      <Button className="h-11.5 px-5.5" disabled={!canContinue} onClick={onContinue}>
        {label}
      </Button>
    </div>
  )
}
