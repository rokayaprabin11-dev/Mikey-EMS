import crestUrl from '../../assets/school-logo.png'
import { en } from '../i18n/en.ts'

// The crest bundled with the app (DECISIONS D28), drawn 40 wide by 44 high, so `width` sets both.
export function Crest({ width }: { width: number }) {
  return <img src={crestUrl} alt={en.crest} width={width} height={Math.round((width * 44) / 40)} />
}
