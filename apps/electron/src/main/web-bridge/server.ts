import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { URL } from 'url'
import { extractBearerToken, validateToken } from './auth'
import type { SessionEvent } from '../../shared/types'

export interface RouteHandler {
  (params: Record<string, string>, body: unknown, req: IncomingMessage): Promise<unknown>
}

export interface Route {
  method: string
  pattern: RegExp
  paramNames: string[]
  handler: RouteHandler
}

export interface WebBridgeServerOptions {
  port: number
  bindAddress: string
  routes: Route[]
  clientHtml: string
}

/**
 * Simple HTTP + WebSocket server for the WebBridge.
 * No external framework dependencies — uses Node.js http + ws library.
 */
export function createWebBridgeServer(options: WebBridgeServerOptions) {
  const { port, bindAddress, routes, clientHtml } = options
  const wsClients = new Set<WebSocket>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Serve web client at root
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(clientHtml)
      return
    }

    // All /api/* routes require auth
    if (req.url?.startsWith('/api/')) {
      const token = extractBearerToken(req.headers.authorization)
      if (!token || !validateToken(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      // Parse URL
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      const pathname = parsedUrl.pathname

      // Match route
      for (const route of routes) {
        if (route.method !== req.method) continue

        const match = pathname.match(route.pattern)
        if (!match) continue

        // Extract params
        const params: Record<string, string> = {}
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1]
        })

        // Parse body for POST/PUT/DELETE
        let body: unknown = undefined
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
          try {
            body = await parseJsonBody(req)
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON body' }))
            return
          }
        }

        // Execute handler
        try {
          const result = await route.handler(params, body, req)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result ?? { success: true }))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Internal server error'
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
        return
      }

      // No route matched
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    // Unknown path
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })

  // WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate WebSocket via query param
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (!token || !validateToken(token)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    wsClients.add(ws)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      wsClients.delete(ws)
    })

    // Send connected confirmation
    ws.send(JSON.stringify({ type: 'connected' }))
  })

  /**
   * Broadcast a session event to all connected WebSocket clients.
   */
  function broadcast(event: SessionEvent): void {
    const data = JSON.stringify(event)
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  /**
   * Start listening on the configured port.
   */
  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      httpServer.on('error', reject)
      httpServer.listen(port, bindAddress, () => {
        resolve()
      })
    })
  }

  /**
   * Stop the server and close all connections.
   */
  function stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const client of wsClients) {
        client.close(1001, 'Server shutting down')
      }
      wsClients.clear()

      wss.close(() => {
        httpServer.close(() => {
          resolve()
        })
      })
    })
  }

  return { start, stop, broadcast }
}

/**
 * Parse JSON body from an incoming HTTP request.
 */
function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw || raw.trim() === '') {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Helper to create a route definition with path params.
 * Path format: "/api/sessions/:id/messages"
 * Converts :param segments to named capture groups.
 */
export function defineRoute(method: string, path: string, handler: RouteHandler): Route {
  const paramNames: string[] = []
  const regexStr = path.replace(/:([a-zA-Z]+)/g, (_match, paramName) => {
    paramNames.push(paramName)
    return '([^/]+)'
  })
  return {
    method,
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
    handler,
  }
}
