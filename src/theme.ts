import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: { main: '#3f51b5' },
    background: { default: '#f6f7fb' },
  },
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
          backgroundColor: t.palette.grey[50],
        }),
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
  },
})
