import { useLocation } from 'react-router-dom'

/** Opens the issue over the current page (?issue=KEY), keeping the rest of the URL. */
export function useIssueHref() {
  const { pathname, search } = useLocation()
  return (key: string) => {
    const params = new URLSearchParams(search)
    params.set('issue', key)
    return `${pathname}?${params}`
  }
}
