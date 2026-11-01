import { RadioCard, RadioGroup } from '../components/ui/radio-group.tsx'
import { en } from '../i18n/en.ts'
import { StepNav } from './StepNav.tsx'

const words = en.setup.which

// Step 1. Computer 1's own setup comes in a later version, so only Computer 2 can be chosen.
export function WhichComputer({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-[38px] leading-[1.1] font-semibold">{words.title}</h1>
        <p className="text-[15px] leading-relaxed text-ink-soft">{words.intro}</p>
        <RadioGroup aria-label={words.label} value="counter">
          <RadioCard value="server" disabled>
            <span className="flex flex-col gap-1">
              <span className="font-display text-[21px] font-semibold">{words.server}</span>
              <span className="text-sm leading-normal text-ink-soft">{words.serverHelp}</span>
              <span className="text-[13px] font-semibold text-ink-muted">{words.serverLater}</span>
            </span>
          </RadioCard>
          <RadioCard value="counter">
            <span className="flex flex-col gap-1">
              <span className="font-display text-[21px] font-semibold">{words.counter}</span>
              <span className="text-sm leading-normal text-ink-soft">{words.counterHelp}</span>
            </span>
          </RadioCard>
        </RadioGroup>
      </section>
      <StepNav onContinue={onContinue} />
    </>
  )
}
