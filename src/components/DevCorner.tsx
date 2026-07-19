import { DevCorner as PortableDevCorner, type HistoryEntry } from '@adomas/dev-tools'
import { CHANGELOG } from '../lib/changelog'

/**
 * Karin's binding to the SHARED dev corner (`@adomas/dev-tools`, the same package
 * Pepper renders): the bottom-right chip holding the edit tray, the CSS x-ray and
 * the version history. It lives in its own repo, so a fix there lands in every app —
 * this file only hands it Karin's changelog.
 *
 * The corner writes `v.` in front of the number itself, and our changelog stores it
 * as part of the string, so it is stripped here rather than duplicated on screen.
 */
const strip = (v: string) => v.replace(/^v\./, '')

const entries: HistoryEntry[] = CHANGELOG.map((e) => ({ ...e, version: strip(e.version) }))

export default function DevCorner() {
  return <PortableDevCorner history={{ version: strip(CHANGELOG[0].version), entries }} />
}
