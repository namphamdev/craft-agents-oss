import { randomBytes, timingSafeEqual } from 'crypto'

let serverToken: string | null = null

/**
 * Generate a new bearer token for the WebBridge server.
 * Called once on server start. Returns the token for display to the user.
 */
export function generateToken(): string {
  serverToken = randomBytes(32).toString('hex')
  return serverToken
}

/**
 * Validate a bearer token from an HTTP request or WebSocket connection.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateToken(token: string): boolean {
  if (!serverToken) return false
  if (token.length !== serverToken.length) return false
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(serverToken))
  } catch {
    return false
  }
}

/**
 * Extract bearer token from Authorization header.
 * Expects: "Bearer <token>"
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  return parts[1]
}

/**
 * Get the current server token (for display purposes).
 */
export function getToken(): string | null {
  return serverToken
}
