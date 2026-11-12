import { lazy, Suspense, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined'
import SearchIcon from '@mui/icons-material/Search'
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined'
import { useAuth, useMe } from '../auth/AuthProvider'
import { APP_NAME, APP_ROLE_LABELS } from '../lib/constants'
import { isShortcut, shortcutLabel } from '../lib/search'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import AppSwitcher from './AppSwitcher'
import { useNavCollapsed } from './useNavCollapsed'
import { Logo, PersonAvatar } from './common'
import { InstallBanner, InstallNavButton } from './InstallApp'
import { ProjectAvatar } from './IssueBits'
import NotificationsBell from './NotificationsBell'
import ThemeModeSwitch from './ThemeModeSwitch'
import { onWorkerMessage, routerPath } from '../pwa'
import type { CreateDefaults } from './CreateIssueDialog'
import { LayoutContext, type LayoutActions } from './layoutContext'

// Both carry the rich text editor, so they load on first use; search and
// Create (with the note and event dialogs) too.
const IssueDialog = lazy(() => import('./IssueDialog'))
const CreateIssueDialog = lazy(() => import('./CreateIssueDialog'))
const SearchDialog = lazy(() => import('./SearchDialog'))
const CreateMenu = lazy(() => import('./CreateMenu'))
const NotificationSettings = lazy(() => import('./NotificationSettings'))

// The same sizes as the other Elevance apps.
const DRAWER_WIDTH = 248
// Collapsed, the navigation is a rail just wide enough for its icons.
const RAIL_WIDTH = 68

interface NavItem {
  to: string
  label: string
  icon: ReactElement
}

const FOR_YOU: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
  { to: '/issues', label: 'Issues', icon: <FilterListOutlinedIcon /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarMonthOutlinedIcon /> },
  { to: '/todos', label: 'Todos', icon: <ChecklistOutlinedIcon /> },
  { to: '/notes', label: 'Notes', icon: <StickyNote2OutlinedIcon /> },
]

const ADMIN: NavItem[] = [
  { to: '/admin/people', label: 'People', icon: <PeopleOutlineIcon /> },
  { to: '/admin/issue-types', label: 'Issue types', icon: <CategoryOutlinedIcon /> },
  { to: '/admin/workspace', label: 'Workspace', icon: <AdminPanelSettingsOutlinedIcon /> },
]

/** Looks like a search box; opens search (as Cmd/Ctrl+S does). */
function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <ButtonBase onClick={onOpen} aria-label="Search" aria-keyshortcuts="Meta+S Control+S"
      sx={{
        width: 300, height: 40, px: 1.5, gap: 1, justifyContent: 'flex-start', borderRadius: 1, border: 1, borderColor: 'divider',
        bgcolor: 'background.default', color: 'text.secondary', '&:hover': { borderColor: 'text.primary' },
      }}>
      <SearchIcon fontSize="small" />
      <Typography variant="body2" sx={{ flexGrow: 1, textAlign: 'left' }}>Search</Typography>
      <Typography component="kbd" variant="caption" sx={{ px: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, fontFamily: 'inherit' }}>
        {shortcutLabel('s')}
      </Typography>
    </ButtonBase>
  )
}

export default function Layout() {
  const me = useMe()
  const { signOut, isAdmin } = useAuth()
  const { projects } = useWorkspace()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('lg'))
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  // On a wide screen the navigation folds to a rail of icons; the choice is
  // remembered, and shared with the other Elevance apps.
  const [collapsed, toggleCollapsed] = useNavCollapsed()
  const rail = desktop && collapsed
  const navWidth = rail ? RAIL_WIDTH : DRAWER_WIDTH
  const navLabel = rail ? 'Expand navigation' : 'Collapse navigation'
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null)
  const [searching, setSearching] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [create, setCreate] = useState<CreateDefaults | null>(null)
  const [notificationSettings, setNotificationSettings] = useState(false)
  const openIssue = new URLSearchParams(search).get('issue')

  // Cmd/Ctrl+S searches (instead of saving the page); Cmd/Ctrl+K creates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, 's')) {
        e.preventDefault()
        setChoosing(false)
        setSearching(true)
      } else if (isShortcut(e, 'k')) {
        e.preventDefault()
        setSearching(false)
        setChoosing(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A tapped device notification, with the app already open: the service
  // worker focuses this window and names the page. An issue opens over
  // whatever page is showing (as from the bell); anything else is navigated
  // to. No reload, so nothing typed elsewhere is lost.
  useEffect(() => onWorkerMessage((m) => {
    if (m.type !== 'open') return
    const route = routerPath(m.url)
    if (!route) return
    const issue = new URL(route, 'http://x').searchParams.get('issue')
    if (issue) navigate({ pathname, search: `?issue=${encodeURIComponent(issue)}` })
    else navigate(route)
  }), [navigate, pathname])

  const actions = useMemo<LayoutActions>(() => ({ openCreate: (defaults = {}) => setCreate(defaults) }), [])
  const current = projects.filter((p) => !p.archived_at)
  const projectInPath = /^\/projects\/([A-Z0-9]+)/.exec(pathname)?.[1]

  const item = (i: NavItem, selected: boolean) => (
    <Tooltip key={i.to} title={rail ? i.label : ''} placement="right">
      <ListItemButton
        component={Link}
        to={i.to}
        selected={selected}
        aria-label={i.label}
        onClick={() => setMobileOpen(false)}
        sx={{
          borderRadius: 2,
          mb: 0.5,
          justifyContent: rail ? 'center' : 'flex-start',
          '&.Mui-selected': { color: 'primary.main', '& .MuiListItemIcon-root': { color: 'primary.main' } },
        }}
      >
        <ListItemIcon sx={{ minWidth: rail ? 0 : 40 }}>{i.icon}</ListItemIcon>
        {!rail && <ListItemText primary={i.label} slotProps={{ primary: { sx: { fontWeight: 500 }, noWrap: true } }} />}
      </ListItemButton>
    </Tooltip>
  )

  const subheader = (title: string) =>
    rail ? (
      <Box sx={{ height: 12 }} />
    ) : (
      <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>{title}</ListSubheader>
    )
  const listSx = { px: rail ? 1 : 1.5 }

  const drawer = (
    <>
      <Toolbar />
      {/* On a phone the offer to install leads the navigation, until dismissed. */}
      {!desktop && <InstallBanner />}
      <List sx={listSx} subheader={subheader('For you')}>
        {FOR_YOU.map((i) => item(i, pathname === i.to || pathname.startsWith(`${i.to}/`)))}
      </List>
      <List sx={listSx} subheader={subheader('Projects')}>
        {item({ to: '/projects', label: 'All projects', icon: <FolderOutlinedIcon /> }, pathname === '/projects')}
        {current.map((p) => (
          <Tooltip key={p.id} title={rail ? p.name : ''} placement="right">
            <ListItemButton
              component={Link}
              to={`/projects/${p.key}`}
              selected={projectInPath === p.key}
              aria-label={p.name}
              onClick={() => setMobileOpen(false)}
              sx={{ borderRadius: 2, mb: 0.5, justifyContent: rail ? 'center' : 'flex-start', '&.Mui-selected': { color: 'primary.main' } }}
            >
              <ListItemIcon sx={{ minWidth: rail ? 0 : 40 }}>
                <ProjectAvatar project={p} />
              </ListItemIcon>
              {!rail && <ListItemText primary={p.name} slotProps={{ primary: { sx: { fontWeight: 500 }, noWrap: true } }} />}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
      {isAdmin && (
        <List sx={listSx} subheader={subheader('Admin')}>
          {ADMIN.map((i) => item(i, pathname.startsWith(i.to)))}
        </List>
      )}
      {/* Pinned to the foot of the navigation, where it stays put whether the
          navigation is folded or not. Not a page, so not a list item. Install
          shares the row, after Collapse; on the rail it sits above it. */}
      {desktop && (
        <Box
          sx={{
            mt: 'auto', position: 'sticky', bottom: 0, p: 1, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
            display: 'flex', flexDirection: rail ? 'column' : 'row', gap: 0.5,
          }}
        >
          {rail && <InstallNavButton rail />}
          <Tooltip title={rail ? navLabel : ''} placement="right">
            <ButtonBase
              onClick={toggleCollapsed}
              aria-label={navLabel}
              aria-expanded={!rail}
              sx={{
                flex: rail ? 'none' : 1, minWidth: 0, borderRadius: 2, py: 1, px: rail ? 0 : 1.25, gap: 1.5, color: 'text.secondary',
                justifyContent: rail ? 'center' : 'flex-start', '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {rail ? <KeyboardDoubleArrowRightIcon /> : <KeyboardDoubleArrowLeftIcon />}
              {!rail && <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>Collapse</Typography>}
            </ButtonBase>
          </Tooltip>
          {!rail && <InstallNavButton rail={false} />}
        </Box>
      )}
    </>
  )

  return (
    <LayoutContext.Provider value={actions}>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar position="fixed" color="inherit" elevation={0} sx={{ zIndex: theme.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: { xs: 0.75, sm: 1.5 } }}>
            {!desktop && (
              <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
                <MenuIcon />
              </IconButton>
            )}
            <AppSwitcher current="work" email={me.email} />
            <ButtonBase component={Link} to="/dashboard" sx={{ gap: 1.25, borderRadius: 1 }} aria-label={APP_NAME}>
              <Logo />
              <Typography variant="h6" component="div" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
                {APP_NAME}
              </Typography>
            </ButtonBase>
            <Box sx={{ flexGrow: 1 }} />
            {wide ? (
              <SearchButton onOpen={() => setSearching(true)} />
            ) : (
              <Tooltip title={`Search (${shortcutLabel('s')})`}>
                <IconButton aria-label="Search" onClick={() => setSearching(true)}>
                  <SearchIcon />
                </IconButton>
              </Tooltip>
            )}
            {/* Create (or Cmd/Ctrl+K) asks what to make: an issue, todo, note or event. */}
            <Tooltip title={`Create (${shortcutLabel('k')})`}>
              {wide ? (
                <Button variant="contained" startIcon={<AddIcon />} aria-keyshortcuts="Meta+K Control+K" onClick={() => setChoosing(true)}>
                  Create
                </Button>
              ) : (
                <IconButton aria-label="Create" aria-keyshortcuts="Meta+K Control+K" color="primary" onClick={() => setChoosing(true)}>
                  <AddIcon />
                </IconButton>
              )}
            </Tooltip>
            <NotificationsBell />
            <ButtonBase
              onClick={(e) => setUserMenu(e.currentTarget)}
              aria-label="Account menu"
              sx={{ borderRadius: 6, py: 0.5, pl: 0.5, pr: { xs: 0.5, sm: 1 }, gap: 1.25, flexShrink: 0, '&:hover': { bgcolor: 'action.hover' } }}
            >
              <PersonAvatar person={me} size={34} />
              {/* The header also carries search, Create and the bell, so the
                  name appears only where there is room for all of it. */}
              <Box sx={{ textAlign: 'left', display: { xs: 'none', lg: 'block' } }}>
                <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2 }}>{me.full_name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{APP_ROLE_LABELS[me.app_role]}</Typography>
              </Box>
              <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }} />
            </ButtonBase>
            <Menu
              anchorEl={userMenu}
              open={!!userMenu}
              onClose={() => setUserMenu(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { mt: 1, minWidth: 240 } } }}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2">{me.full_name}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{me.email}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{me.title ?? APP_ROLE_LABELS[me.app_role]}</Typography>
              </Box>
              <Divider />
              <ThemeModeSwitch />
              <Divider />
              <MenuItem
                onClick={() => {
                  setUserMenu(null)
                  setNotificationSettings(true)
                }}
              >
                <ListItemIcon>
                  <NotificationsNoneOutlinedIcon fontSize="small" />
                </ListItemIcon>
                Notifications
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setUserMenu(null)
                  signOut()
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                Sign out
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Drawer
          variant={desktop ? 'permanent' : 'temporary'}
          open={desktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ width: navWidth, flexShrink: 0 }}
          slotProps={{ paper: { sx: { width: desktop ? navWidth : DRAWER_WIDTH, boxSizing: 'border-box', overflowX: 'hidden' } } }}
        >
          {drawer}
        </Drawer>

        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
          <Toolbar />
          <Outlet />
        </Box>
      </Box>
      <Suspense fallback={null}>
        {openIssue && <IssueDialog issueKey={openIssue} />}
        {create && <CreateIssueDialog defaults={create} onClose={() => setCreate(null)} />}
        {searching && <SearchDialog onClose={() => setSearching(false)} />}
        {choosing && <CreateMenu onIssue={() => setCreate({})} onClose={() => setChoosing(false)} />}
        {notificationSettings && <NotificationSettings onClose={() => setNotificationSettings(false)} />}
      </Suspense>
    </LayoutContext.Provider>
  )
}
