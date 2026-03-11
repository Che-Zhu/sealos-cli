import { Command } from 'commander'
import { upsertContext } from '../../lib/config.ts'
import { deviceGrantLogin } from '../../lib/oauth.ts'
import { success, error as logError, spinner } from '../../lib/output.ts'
import { handleError } from '../../lib/errors.ts'

export function createLoginCommand (): Command {
  return new Command('login')
    .description('Login to Sealos Cloud')
    .argument('<host>', 'Sealos host (e.g., usw.sealos.io or https://usw.sealos.io)')
    .option('-t, --token <token>', 'Login with token')
    .action(async (host: string, options) => {
      // Login flow:
      // 1. With --token: save token directly as context
      // 2. Without --token: OAuth2 Device Grant (RFC 8628)
      //    a. Request device code from /api/auth/oauth2/device
      //    b. User opens browser to authorize
      //    c. Poll /api/auth/oauth2/token until approved
      //    d. Exchange access_token for kubeconfig
      //    e. Save kubeconfig as context token
      try {
        const spin = spinner('Logging in...')
        const region = normalizeHost(host)

        // Direct token login
        if (options.token) {
          upsertContext({
            name: host,
            host: region,
            token: options.token,
            workspace: 'default'
          })
          spin.succeed(`Logged in to ${host}`)
          return
        }

        // OAuth2 Device Grant flow
        const result = await deviceGrantLogin(region, spin)

        // Save kubeconfig as context token
        upsertContext({
          name: host,
          host: result.region,
          token: result.kubeconfig,
          workspace: 'default'
        })

        spin.succeed(`Logged in to ${host}`)
        success('Authentication successful')
      } catch (err) {
        logError('Login failed')
        handleError(err)
      }
    })
}

/**
 * Normalize a host argument to an https:// URL.
 * Accepts bare hostnames (usw.sealos.io) or full URLs (https://usw.sealos.io).
 */
function normalizeHost (host: string): string {
  const trimmed = host.replace(/\/+$/, '')
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }
  return `https://${trimmed}`
}
