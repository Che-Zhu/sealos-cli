import { execSync } from 'node:child_process'
import { platform } from 'node:os'
import type { Ora } from 'ora'
import chalk from 'chalk'
import { CLIENT_ID } from './constants.ts'

interface DeviceAuthResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

interface TokenResponse {
  access_token: string
  token_type: string
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * POST /api/auth/oauth2/device to start device authorization.
 */
export async function requestDeviceAuthorization (region: string): Promise<DeviceAuthResponse> {
  const res = await fetch(`${region}/api/auth/oauth2/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  })

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || ''
    if (res.status === 404) {
      throw new Error(
        'OAuth2 device grant not supported on this host.\n' +
        `'${region}' does not have the device authorization endpoint.`
      )
    }
    const body = contentType.includes('text/html')
      ? ''
      : await res.text().catch(() => '')
    throw new Error(`Device authorization request failed (${res.status}): ${body || res.statusText}`)
  }

  return res.json() as Promise<DeviceAuthResponse>
}

/**
 * Poll POST /api/auth/oauth2/token until the user authorizes.
 * Handles: authorization_pending, slow_down (+5s per RFC 8628 §3.5),
 * access_denied, expired_token. Hard cap at 10 minutes.
 */
export async function pollForToken (
  region: string,
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<TokenResponse> {
  const maxWait = Math.min(expiresIn, 600) * 1000
  const deadline = Date.now() + maxWait
  let pollInterval = interval * 1000

  while (Date.now() < deadline) {
    await sleep(pollInterval)

    const res = await fetch(`${region}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode
      })
    })

    if (res.ok) {
      return res.json() as Promise<TokenResponse>
    }

    const body = await res.json().catch(() => ({})) as { error?: string }

    switch (body.error) {
      case 'authorization_pending':
        break

      case 'slow_down':
        pollInterval += 5000
        break

      case 'access_denied':
        throw new Error('Authorization denied by user')

      case 'expired_token':
        throw new Error('Device code expired. Please run login again.')

      default:
        throw new Error(`Token request failed: ${body.error || res.statusText}`)
    }
  }

  throw new Error('Authorization timed out (10 minutes). Please run login again.')
}

/**
 * Exchange an OAuth access token for a Sealos kubeconfig.
 */
export async function exchangeForKubeconfig (region: string, accessToken: string): Promise<string> {
  const res = await fetch(`${region}/api/auth/getDefaultKubeconfig`, {
    method: 'POST',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kubeconfig exchange failed (${res.status}): ${body || res.statusText}`)
  }

  const data = await res.json() as { data?: { kubeconfig?: string } }
  const kubeconfig = data.data?.kubeconfig

  if (!kubeconfig) {
    throw new Error('API response missing data.kubeconfig field')
  }

  return kubeconfig
}

/**
 * Open a URL in the user's default browser. Swallows errors silently.
 */
export function openBrowser (url: string): void {
  try {
    const os = platform()
    const cmd = os === 'darwin' ? 'open' : os === 'win32' ? 'start' : 'xdg-open'
    execSync(`${cmd} "${url}"`, { stdio: 'ignore' })
  } catch {
    // Silently ignore — user can open manually
  }
}

/**
 * Orchestrate the full OAuth2 Device Grant login flow.
 */
export async function deviceGrantLogin (
  region: string,
  spinner: Ora
): Promise<{ kubeconfig: string; region: string }> {
  // Step 1: Request device authorization
  spinner.stop()
  const deviceAuth = await requestDeviceAuthorization(region)

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval = 5
  } = deviceAuth

  // Step 2: Display verification info
  const url = verificationUriComplete || verificationUri
  console.log()
  console.log(chalk.bold('  Open this URL to authorize:'))
  console.log(`  ${chalk.cyan(url)}`)
  console.log()
  console.log(`  Code: ${chalk.bold.yellow(userCode)}`)
  console.log()

  // Step 3: Auto-open browser
  openBrowser(url)

  // Step 4: Poll for token
  spinner.start('Waiting for authorization...')
  const tokenResponse = await pollForToken(region, deviceCode, interval, expiresIn)
  const accessToken = tokenResponse.access_token

  if (!accessToken) {
    throw new Error('Token response missing access_token')
  }

  // Step 5: Exchange for kubeconfig
  spinner.text = 'Exchanging for kubeconfig...'
  const kubeconfig = await exchangeForKubeconfig(region, accessToken)

  return { kubeconfig, region }
}
