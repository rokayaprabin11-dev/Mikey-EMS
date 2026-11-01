import { type AdDate, adToBs, bsMonthName, type FinanceDashboard, formatRupees } from '@mikey/shared'
import { useCallback, useState } from 'react'
import { Bar, BarChart, Cell, XAxis } from 'recharts'

import { en } from '../i18n/en.ts'

const words = en.dashboard
const HEIGHT = 176

// The width of the chart's box, followed as the window is resized; 0 until it has been laid out.
function useWidth(): [(element: HTMLDivElement | null) => (() => void) | undefined, number] {
  const [width, setWidth] = useState(0)
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (element === null) {
      return undefined
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [measure, width]
}

// Money taken on each school day of this BS month so far, today in the action colour and the
// other days in a muted tint, with the figures in words underneath (docs/DESIGN_SYSTEM.md,
// Charts). Days with nothing taken are school holidays, so they have no bar.
export function CollectionChart({
  days,
  today,
  todayAmount,
}: {
  days: FinanceDashboard['collectionByDay']
  today: AdDate
  todayAmount: number
}) {
  const [measure, width] = useWidth()
  const bars = [
    ...days.filter((day) => day.date !== today).map((day) => ({ key: day.date, label: String(adToBs(day.date).day), amount: day.amount })),
    { key: today, label: words.today, amount: todayAmount },
  ]
  return (
    <figure className="flex flex-col gap-3 px-5 pb-5">
      <div ref={measure} aria-hidden="true" className="h-44">
        {width > 0 && (
          <BarChart width={width} height={HEIGHT} data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="14%">
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ className: 'fill-ink-muted text-xs' }} />
            <Bar dataKey="amount" isAnimationActive={false}>
              {bars.map((bar) => (
                <Cell key={bar.key} className={bar.key === today ? 'fill-action' : 'fill-ink-muted/35'} />
              ))}
            </Bar>
          </BarChart>
        )}
      </div>
      <figcaption className="text-[13px] text-ink-muted">
        {words.chartSummary(bsMonthName(adToBs(today).month), formatRupees(todayAmount))}
      </figcaption>
    </figure>
  )
}
