'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageCircle,
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProfileContext } from '@/lib/hooks/use-profile'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// ---------------------------------------------------------------------------
// Preguntas sugeridas
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS = [
  { label: 'Quienes trabajan hoy?', question: '¿Quién trabaja hoy?' },
  { label: 'Stock en rojo?', question: '¿Qué stock está en rojo?' },
  { label: 'Productos para pedir?', question: '¿Qué productos hay que pedir?' },
  { label: 'Egresos sin marcar?', question: '¿Hay egresos sin marcar?' },
  { label: 'Avisos urgentes?', question: '¿Qué avisos urgentes hay?' },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatbotPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const router = useRouter()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // Proteccion de rol
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!profileLoading && profile && profile.role !== 'encargado') {
      router.replace('/')
    }
  }, [profile, profileLoading, router])

  // -------------------------------------------------------------------------
  // Auto-scroll al ultimo mensaje
  // -------------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // -------------------------------------------------------------------------
  // Enviar mensaje
  // -------------------------------------------------------------------------

  async function handleSend(text?: string) {
    const messageText = (text ?? input).trim()
    if (!messageText || isThinking) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsThinking(true)

    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText }),
      })

      if (!res.ok) {
        throw new Error('Error en la respuesta del servidor')
      }

      const data = await res.json()

      const botMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response ?? 'No pude procesar tu consulta.',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, botMessage])
    } catch {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Hubo un error al procesar tu consulta. Por favor, intenta de nuevo.',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsThinking(false)
      // Refocus el input
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // -------------------------------------------------------------------------
  // Loading / acceso denegado
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile || profile.role !== 'encargado') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">
          No tienes acceso a esta seccion.
        </p>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={{ height: 'calc(100svh - 8rem)' }}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
          <MessageCircle className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Asistente LVE
          </h1>
          <p className="text-xs text-muted-foreground">
            Preguntame sobre el equipo, stock, turnos y mas
          </p>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
        {/* Mensaje de bienvenida */}
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="size-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">
                Hola, {profile.first_name}!
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Soy tu asistente de gestion. Haceme cualquier consulta sobre la
                operacion de La Vieja Escuela.
              </p>
            </div>

            {/* Preguntas sugeridas */}
            <div className="flex flex-wrap justify-center gap-2 px-2">
              {SUGGESTED_QUESTIONS.map((sq) => (
                <button
                  key={sq.question}
                  onClick={() => handleSend(sq.question)}
                  className="rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary"
                >
                  {sq.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Lista de mensajes */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-2 ${
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* Avatar */}
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="size-4" />
              ) : (
                <Bot className="size-4" />
              )}
            </div>

            {/* Burbuja */}
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/70 text-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p
                className={`mt-1 text-[10px] ${
                  msg.role === 'user'
                    ? 'text-primary-foreground/60'
                    : 'text-muted-foreground'
                }`}
              >
                {msg.timestamp.toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {/* Indicador de que esta pensando */}
        {isThinking && (
          <div className="flex items-start gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
              <Bot className="size-4" />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl bg-secondary/70 px-3 py-2.5">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {/* Preguntas sugeridas despues de respuesta */}
        {messages.length > 0 && !isThinking && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTED_QUESTIONS.map((sq) => (
              <button
                key={sq.question}
                onClick={() => handleSend(sq.question)}
                className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
              >
                {sq.label}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input de mensaje */}
      <div className="mt-3 flex items-center gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe tu consulta..."
          disabled={isThinking}
          className="flex-1"
        />
        <Button
          size="icon"
          onClick={() => handleSend()}
          disabled={!input.trim() || isThinking}
          aria-label="Enviar mensaje"
        >
          {isThinking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
