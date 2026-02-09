import { randomBytes, timingSafeEqual } from 'crypto'

let serverToken: string | null = null

/** Minimum length for custom auth codes */
const MIN_TOKEN_LENGTH = 4

/**
 * Generate a new random bearer token for the WebBridge server.
 * Called on server start if no custom token is set. Returns the token for display.
 */
export function generateToken(): string {
  serverToken = randomBytes(32).toString('hex')
  return serverToken
}

/**
 * Set a custom auth token (user-provided auth code).
 * Must be at least MIN_TOKEN_LENGTH characters.
 * Returns the token on success, or throws if invalid.
 */
export function setToken(customToken: string): string {
  if (!customToken || customToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(`Auth code must be at least ${MIN_TOKEN_LENGTH} characters`)
  }
  serverToken = customToken
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
