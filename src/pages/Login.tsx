import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import GoogleIcon from '@mui/icons-material/Google'
import { useAuth } from '../auth/AuthProvider'
import { Logo } from '../components/common'
import { APP_NAME, COMPANY_DOMAIN } from '../lib/constants'

export default function Login() {
  const { signIn, error } = useAuth()

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', px: 2, bgcolor: 'background.default' }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Logo size={56} />
            <Box>
              <Typography variant="h5" component="h1">{APP_NAME}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                Sign in with your @{COMPANY_DOMAIN} Google account
              </Typography>
            </Box>
            {error && (
              <Alert severity="error" sx={{ textAlign: 'left', width: '100%' }}>
                {error}
              </Alert>
            )}
            <Button variant="contained" size="large" fullWidth startIcon={<GoogleIcon />} onClick={signIn}>
              Sign in with Google
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
