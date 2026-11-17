// The phone's main navigation: four tabs fixed to the foot of the screen,
// clear of the home indicator when installed. Home is today (with the full
// calendar a tap away), Work is projects and issues, then Todos and Notes.
// Everything else stays in the drawer. Below `md` only; wider screens have
// the side navigation.
import type { ReactElement } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined'
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined'

/** Height of the bar itself (the safe-area inset comes on top). */
export const BOTTOM_NAV_HEIGHT = 56

interface Tab {
  to: string
  label: string
  icon: ReactElement
  /** Paths (and what's under them) the tab stands for. */
  match: string[]
}

const TABS: Tab[] = [
  { to: '/dashboard', label: 'Home', icon: <HomeOutlinedIcon />, match: ['/dashboard', '/calendar'] },
  { to: '/work', label: 'Work', icon: <ViewKanbanOutlinedIcon />, match: ['/work', '/projects', '/issues', '/browse'] },
  { to: '/todos', label: 'Todos', icon: <ChecklistOutlinedIcon />, match: ['/todos'] },
  { to: '/notes', label: 'Notes', icon: <StickyNote2OutlinedIcon />, match: ['/notes'] },
]

/** Which tab a page belongs to, if any. */
function bottomTabOf(pathname: string): string | false {
  return TABS.find((t) => t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`)))?.to ?? false
}

export default function BottomNav() {
  const { pathname } = useLocation()
  return (
    <Paper
      component="nav"
      aria-label="Main"
      square
      elevation={0}
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (t) => t.zIndex.appBar,
        borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation showLabels value={bottomTabOf(pathname)} sx={{ height: BOTTOM_NAV_HEIGHT, bgcolor: 'transparent' }}>
        {TABS.map((t) => (
          <BottomNavigationAction key={t.to} component={Link} to={t.to} value={t.to} label={t.label} icon={t.icon} />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
