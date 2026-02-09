import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AppAdapterProvider,
  PlatformProvider,
  type AppAdapter,
  type AdapterSessionEvent,
  type PlatformActions,
  SessionViewer,
  type SessionViewerMode,
} from '@craft-agent/ui'
import { createWebAdapter } from '@craft-agent/ui/adapters/web'
import type { Session, SessionMetadata, Message } from '@craft-agent/core'

// ============================================================================
// Adapter setup
// ============================================================================

const adapter = createWebAdapter({ baseUrl: '/api' })

// Platform actions for the read-only SessionViewer components
const platformActions: PlatformActions = {
  onOpenUrl: (url) => window.open(url, '_blank'),
  onCopyToClipboard: (text) => navigator.clipboard.writeText(text),
}

// ============================================================================
// Chat component (interactive input + message display)
// ============================================================================

interface ChatViewProps {
  sessionId: string
  workspaceId: string
}

function ChatView({ sessionId, workspaceId }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load session messages
  useEffect(() => {
    adapter.getSession(sessionId).then((session) => {
      if (session?.messages) {
        setMessages(session.messages)
      }
    })
  }, [sessionId])

  // Subscribe to SSE events
  useEffect(() => {
    const cleanup = adapter.onSessionEvent((event: AdapterSessionEvent) => {
      if (event.sessionId !== sessionId) return

      switch (event.event.type) {
        case 'text_delta':
          setStreamingText(prev => prev + event.event.text)
          break
        case 'text_complete': {
          const text = (event.event as any).text
          if (text && !(event.event as any).isIntermediate) {
            setMessages(prev => [...prev, {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
            }])
          }
          setStreamingText('')
          break
        }
        case 'tool_start':
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`,
            role: 'tool' as any,
            content: '',
            timestamp: Date.now(),
            toolName: (event.event as any).toolName,
            toolUseId: (event.event as any).toolUseId,
            toolStatus: 'executing',
          }])
          break
        case 'tool_result': {
          const toolEvent = event.event as any
          setMessages(prev => prev.map(m =>
            m.toolUseId === toolEvent.toolUseId
              ? { ...m, toolResult: toolEvent.result, toolStatus: toolEvent.isError ? 'error' : 'completed' as any }
              : m
          ))
          break
        }
        case 'complete':
          setIsProcessing(false)
          setStreamingText('')
          break
        case 'error':
          setIsProcessing(false)
          setStreamingText('')
          break
      }
    })
    return cleanup
  }, [sessionId])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isProcessing) return

    // Optimistic user message
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }])
    setInput('')
    setIsProcessing(true)

    try {
      await adapter.sendMessage(sessionId, text)
    } catch (err) {
      setIsProcessing(false)
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}`,
        role: 'error' as any,
        content: err instanceof Error ? err.message : 'Failed to send message',
        timestamp: Date.now(),
      }])
    }
  }, [input, isProcessing, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isProcessing && (
          <div className="flex items-center justify-center h-full text-foreground/40">
            <div className="text-center">
              <h2 className="text-lg font-medium mb-2">Craft Agent</h2>
              <p className="text-sm">Start a conversation to begin.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-accent text-white'
                  : msg.role === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-foreground/5 text-foreground'
              }`}
            >
              {msg.role === 'tool' ? (
                <div className="text-xs font-mono text-foreground/60">
                  {msg.toolName} {msg.toolStatus === 'executing' ? '...' : msg.toolStatus === 'error' ? '(error)' : '(done)'}
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming text */}
        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-xl px-4 py-3 bg-foreground/5 text-foreground">
              <div className="whitespace-pre-wrap text-sm">{streamingText}</div>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && !streamingText && (
          <div className="flex justify-start">
            <div className="rounded-xl px-4 py-3 bg-foreground/5">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-foreground/10 p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-foreground/30"
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
            disabled={isProcessing || !input.trim()}
            className="rounded-xl bg-accent text-white px-4 py-3 text-sm font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Stop' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Sidebar (session list)
// ============================================================================

interface SidebarProps {
  sessions: SessionMetadata[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

function Sidebar({ sessions, selectedId, onSelect, onCreate }: SidebarProps) {
  return (
    <div className="w-64 border-r border-foreground/10 flex flex-col h-full bg-foreground/[0.02]">
      <div className="p-3 border-b border-foreground/10 flex items-center justify-between">
        <h1 className="text-sm font-semibold">Craft Agent</h1>
        <button
          onClick={onCreate}
          className="rounded-lg bg-accent text-white px-3 py-1.5 text-xs font-medium hover:bg-accent/90 transition-colors"
        >
          New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-3 py-2.5 text-sm border-b border-foreground/5 transition-colors hover:bg-foreground/5 ${
              selectedId === s.id ? 'bg-accent/10 text-accent' : 'text-foreground/70'
            }`}
          >
            <div className="truncate font-medium">{s.name || s.preview || 'New Chat'}</div>
            <div className="text-xs text-foreground/40 mt-0.5">
              {new Date(s.lastUsedAt).toLocaleDateString()}
            </div>
          </button>
        ))}
        {sessions.length === 0 && (
          <div className="p-4 text-center text-foreground/30 text-xs">
            No sessions yet. Create a new chat to get started.
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// App
// ============================================================================

export function App() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  // Load workspaces and sessions
  useEffect(() => {
    adapter.getWorkspaces().then((workspaces) => {
      if (workspaces.length > 0) {
        const ws = workspaces[0]
        setWorkspaceId(ws.id)
        adapter.listSessions(ws.id).then(setSessions)
      }
    }).catch(err => {
      console.error('Failed to load workspaces:', err)
    })
  }, [])

  const handleCreateSession = useCallback(async () => {
    if (!workspaceId) return
    try {
      const session = await adapter.createSession(workspaceId)
      setSelectedSessionId(session.id)
      // Refresh session list
      const updated = await adapter.listSessions(workspaceId)
      setSessions(updated)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [workspaceId])

  return (
    <AppAdapterProvider value={adapter}>
      <PlatformProvider actions={platformActions}>
        <div className="flex h-screen bg-background text-foreground">
          <Sidebar
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onCreate={handleCreateSession}
          />
          <div className="flex-1">
            {selectedSessionId && workspaceId ? (
              <ChatView
                key={selectedSessionId}
                sessionId={selectedSessionId}
                workspaceId={workspaceId}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-foreground/30">
                <div className="text-center">
                  <h2 className="text-xl font-medium mb-2">Craft Agent</h2>
                  <p className="text-sm">Select a session or create a new one to get started.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </PlatformProvider>
    </AppAdapterProvider>
  )
}
