import { CHANGELOG } from './changelog'

// Derived from the newest changelog entry so the version and its description
// can never drift. To bump the version, prepend an entry in changelog.ts.
export const APP_VERSION = CHANGELOG[0].version
