import { createTheme, type PaletteOptions } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface TypeBackground {
    /** A quiet, opaque tint for headers and bands set off from paper. */
    subtle: string
    /** A stronger opaque tint: board columns, empty tracks. */
    muted: string
  }
}

/**
 * Where the theme choice (light / dark / system) is kept. One key for every
 * Elevance app: they share an origin, so a choice made in one holds in the
 * next, as the collapsed navigation does.
 */
export const THEME_MODE_KEY = 'elevance.theme'

/** The ThemeProvider's settings beside `theme` (main.tsx and the tests). */
export const themeSettings = {
  defaultMode: 'system',
  modeStorageKey: THEME_MODE_KEY,
  colorSchemeStorageKey: 'elevance.theme-scheme',
  // Read the saved choice on the first render: no flash of the other mode.
  noSsr: true,
  disableTransitionOnChange: true,
} as const

const light: PaletteOptions = {
  primary: { main: '#3f51b5' },
  background: { default: '#f6f7fb', paper: '#ffffff', subtle: '#fafafa', muted: '#f5f5f5' },
}

const dark: PaletteOptions = {
  // Indigo lifted so it reads on a dark surface (and keeps white text).
  primary: { main: '#7986cb' },
  background: { default: '#121318', paper: '#1b1d23', subtle: '#22242b', muted: '#282a32' },
}

export const theme = createTheme({
  // Light and dark, switched without CSS variables: `theme.palette` is the
  // one in use, so code that reads it (charts, `alpha`) follows the mode.
  colorSchemes: { light: { palette: light }, dark: { palette: dark } },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiAutocomplete: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme: t }) => ({
          fontWeight: 600,
          color: t.palette.text.secondary,
          backgroundColor: t.palette.background.subtle,
        }),
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
  },
})
