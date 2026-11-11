// Project keys: what the schema accepts (projects.key), and a first guess
// from the project's name.
export const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/

/** A key from a name: initials of its words, or its first letters. */
export function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4)
  return key.replace(/^[0-9]+/, '').slice(0, 10)
}
