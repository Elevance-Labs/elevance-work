// Unsaved text kept in this browser (as Jira does with a description), so a
// closed dialog or a wrong tap loses nothing. Keyed by person, so a shared
// browser doesn't hand one person's draft to the next. Storage can be
// refused or cleared: a draft is a convenience, never the record.

const PREFIX = 'el-work:draft:'

/** The storage key for one person's draft of one thing (e.g. an issue's description). */
export const draftKey = (personId: string, what: string, id: string) => `${PREFIX}${personId}:${what}:${id}`

export function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Keep a draft; null (or the same text as what's saved) drops it. */
export function writeDraft(key: string, text: string | null, saved?: string) {
  try {
    if (text === null || text === saved) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, text)
  } catch {
    // Not kept: the editor still has it.
  }
}

export const clearDraft = (key: string) => writeDraft(key, null)
