import { readFileSync } from 'fs'
import { join } from 'path'
import { generateToken, getToken } from './auth'
import { createWebBridgeServer } from './server'
import { createRoutes } from './routes'
import type { SessionManager } from '../sessions'
import type { SessionEvent } from '../../shared/types'

export interface WebBridgeOptions {
  sessionManager: SessionManager
  port?: number
  bindAddress?: string
}

export interface WebBridgeInstance {
  /** Broadcast a session event to all connected WebSocket clients */
  broadcast(event: SessionEvent): void
  /** Get access info for display (URL + token) */
  getAccessInfo(): { url: string; token: string }
  /** Stop the server */
  stop(): Promise<void>
}

/**
 * Start the WebBridge server — an HTTP + WebSocket gateway that exposes
 * SessionManager functionality to web browser clients.
 */
export async function startWebBridge(options: WebBridgeOptions): Promise<WebBridgeInstance> {
  const { sessionManager, port = 19876, bindAddress = '127.0.0.1' } = options

  // Generate auth token
  const token = generateToken()

  // Load the embedded web client HTML
  // After build:copy, the file lives at dist/web-bridge/client/index.html
  // __dirname points to dist/ when bundled (main.cjs is at dist/main.cjs)
  let clientHtml: string
  try {
    // Production (bundled): dist/web-bridge/client/index.html
    clientHtml = readFileSync(join(__dirname, 'web-bridge', 'client', 'index.html'), 'utf-8')
  } catch {
    try {
      // Development (source): relative to this file
      clientHtml = readFileSync(join(__dirname, '..', '..', '..', '..', 'src', 'main', 'web-bridge', 'client', 'index.html'), 'utf-8')
    } catch {
      try {
        // Alternative dev path: direct from project root
        clientHtml = readFileSync(join(process.cwd(), 'src', 'main', 'web-bridge', 'client', 'index.html'), 'utf-8')
      } catch {
        clientHtml = `<!DOCTYPE html><html><body><h1>Craft Agents Web Bridge</h1><p>Client HTML not found. The server is running — use the API directly.</p></body></html>`
      }
    }
  }

  // Create routes
  const routes = createRoutes(sessionManager)

  // Create and start server
  const server = createWebBridgeServer({
    port,
    bindAddress,
    routes,
    clientHtml,
  })

  await server.start()

  const url = `http://${bindAddress === '0.0.0.0' ? 'localhost' : bindAddress}:${port}`

  return {
    broadcast: server.broadcast,
    getAccessInfo: () => ({ url, token: getToken()! }),
    stop: server.stop,
  }
}
