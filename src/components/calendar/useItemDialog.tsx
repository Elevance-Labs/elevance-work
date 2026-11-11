// Opening what's on the calendar or the dashboard's agenda: a meeting,
// release or todo in its dialog (ItemDialogs); an issue or epic in the issue
// dialog (?issue=KEY).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarItem } from '../../lib/calendar'
import { useIssueHref } from '../useIssueHref'
import { MeetingDialog, ReleaseDialog, TodoDialog } from './ItemDialogs'

/** `open(item)` shows its dialog; render `dialog` somewhere on the page. onChanged: after a todo is changed there. */
export function useItemDialog(onChanged?: () => void) {
  const [item, setItem] = useState<CalendarItem | null>(null)
  const navigate = useNavigate()
  const href = useIssueHref()
  const open = (i: CalendarItem) => {
    if (i.issue) navigate(href(i.issue.key))
    else setItem(i)
  }
  const close = () => setItem(null)
  const dialog = item?.meeting ? <MeetingDialog meeting={item.meeting} onClose={close} />
    : item?.release ? <ReleaseDialog release={item.release} onClose={close} />
    : item?.todo ? <TodoDialog todo={item.todo} onClose={close} onChanged={onChanged} />
    : null
  return { open, dialog }
}
