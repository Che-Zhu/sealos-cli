import createClient from 'openapi-fetch'
import type { paths as TemplatePaths } from '../generated/template.ts'
import { getCurrentContext } from './config.ts'
import { ConfigError } from './errors.ts'

export function createTemplateClient (options?: { baseUrl?: string }) {
  const context = getCurrentContext()
  const host = options?.baseUrl || context?.host
  if (!host) {
    throw new ConfigError('No Sealos Cloud host configured. Run "sealos login <host>" first.')
  }
  return createClient<TemplatePaths>({ baseUrl: `${host}/api/v2alpha` })
}
