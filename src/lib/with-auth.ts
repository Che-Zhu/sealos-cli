import type { Ora } from 'ora'
import { spinner } from './output.ts'
import { requireAuth } from './auth.ts'
import { handleError } from './errors.ts'

interface AuthContext {
  auth: { Authorization: string }
  spinner: Ora
}

interface ErrorHandlingContext {
  spinner: Ora
}

interface WithAuthOptions {
  spinnerText: string
}

/**
 * Wraps a command handler that requires authentication.
 * Handles: auth check + spinner + try/catch + error handling
 */
export function withAuth<T extends any[]> (
  options: WithAuthOptions,
  fn: (ctx: AuthContext, ...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    const spin = spinner(options.spinnerText)
    try {
      const auth = requireAuth()
      await fn({ auth, spinner: spin }, ...args)
    } catch (error) {
      spin.fail()
      handleError(error)
    }
  }
}

/**
 * Wraps a command handler that does NOT require authentication.
 * Handles: spinner + try/catch + error handling
 */
export function withErrorHandling<T extends any[]> (
  options: WithAuthOptions,
  fn: (ctx: ErrorHandlingContext, ...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    const spin = spinner(options.spinnerText)
    try {
      await fn({ spinner: spin }, ...args)
    } catch (error) {
      spin.fail()
      handleError(error)
    }
  }
}
