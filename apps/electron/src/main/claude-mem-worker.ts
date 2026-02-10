/**
 * claude-mem Worker lifecycle management.
 *
 * Starts the claude-mem Worker HTTP service (localhost:37777) on app launch
 * and stops it on app quit. The Worker stores observations in SQLite + ChromaDB
 * and serves search/timeline/save endpoints used by the MCP server.
 */
import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import log from './logger'

const workerLog = log.scope('claude-mem')

const WORKER_HEALTH_URL = 'http://localhost:37777/api/health'
const HEALTH_CHECK_TIMEOUT = 5000

let workerProcess: ChildProcess | null = null

/**
 * Resolve the path to the claude-mem worker-service.cjs script.
 * Checks both global npm and Homebrew install locations.
 */
function resolveWorkerScript(): string | null {
  const candidates = [
    // npm global (macOS/Linux)
    join(process.env.HOME || '', '.npm-global/lib/node_modules/claude-mem/plugin/scripts/worker-service.cjs'),
    // Homebrew (macOS)
    '/opt/homebrew/lib/node_modules/claude-mem/plugin/scripts/worker-service.cjs',
    // npm global default
    '/usr/local/lib/node_modules/claude-mem/plugin/scripts/worker-service.cjs',
  ]

  for (const path of candidates) {
    if (existsSync(path)) return path
  }

  // Fallback: ask npm where claude-mem is installed
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8', timeout: 5000 }).trim()
    const npmPath = join(globalRoot, 'claude-mem/plugin/scripts/worker-service.cjs')
    if (existsSync(npmPath)) return npmPath
  } catch {
    // npm not available or failed
  }

  return null
}

/**
 * Resolve the path to the bun binary.
 */
function resolveBun(): string | null {
  const candidates = [
    join(process.env.HOME || '', '.bun/bin/bun'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
  ]

  for (const path of candidates) {
    if (existsSync(path)) return path
  }

  // Fallback: find in PATH
  try {
    const bunPath = execSync('which bun', { encoding: 'utf-8', timeout: 3000 }).trim()
    if (bunPath && existsSync(bunPath)) return bunPath
  } catch {
    // bun not in PATH
  }

  return null
}

/**
 * Check if the Worker is already running by hitting the health endpoint.
 */
async function isWorkerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)
    const response = await fetch(WORKER_HEALTH_URL, { signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Start the claude-mem Worker if it's not already running.
 * Called during app initialization.
 */
export async function startClaudeMemWorker(): Promise<void> {
  // Check if already running (e.g., started by Claude Code separately)
  if (await isWorkerRunning()) {
    workerLog.info('Worker already running on port 37777')
    return
  }

  const workerScript = resolveWorkerScript()
  if (!workerScript) {
    workerLog.info('claude-mem not installed, skipping worker start')
    return
  }

  const bunPath = resolveBun()
  if (!bunPath) {
    workerLog.warn('bun runtime not found, cannot start claude-mem worker')
    return
  }

  workerLog.info(`Starting worker: ${bunPath} ${workerScript} start`)

  workerProcess = spawn(bunPath, [workerScript, 'start'], {
    stdio: 'ignore',
    detached: false,
    env: { ...process.env },
  })

  workerProcess.on('error', (err) => {
    workerLog.error('Worker failed to start:', err)
    workerProcess = null
  })

  workerProcess.on('exit', (code) => {
    // The worker-service.cjs "start" command spawns a daemon and exits.
    // Code 0 means the daemon was started successfully.
    workerLog.info(`Worker start command exited with code ${code}`)
    workerProcess = null
  })

  // Wait briefly for the worker to become available
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    if (await isWorkerRunning()) {
      workerLog.info('Worker is ready')
      return
    }
  }

  workerLog.warn('Worker did not become ready within 5 seconds')
}

/**
 * Stop the claude-mem Worker.
 * Called during app quit.
 */
export async function stopClaudeMemWorker(): Promise<void> {
  const workerScript = resolveWorkerScript()
  if (!workerScript) return

  const bunPath = resolveBun()
  if (!bunPath) return

  try {
    execSync(`"${bunPath}" "${workerScript}" stop`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'ignore',
    })
    workerLog.info('Worker stopped')
  } catch {
    workerLog.info('Worker stop command completed (may not have been running)')
  }

  if (workerProcess) {
    workerProcess.kill()
    workerProcess = null
  }
}

/**
 * Get the path to the MCP server script (for use as a stdio source).
 */
export function getClaudeMemMcpServerPath(): string | null {
  const workerScript = resolveWorkerScript()
  if (!workerScript) return null
  // mcp-server.cjs is in the same directory as worker-service.cjs
  const mcpServerPath = join(workerScript, '..', 'mcp-server.cjs')
  return existsSync(mcpServerPath) ? mcpServerPath : null
}
