import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mensajes de la app por Telegram (resúmenes de turno)
// ---------------------------------------------------------------------------
// TELEGRAM_BOT_TOKEN (Vercel) = el bot que manda. Los chats que reciben se
// guardan en app_settings 'telegram_resumenes' al vincular (Más → el socio
// le escribe /start al bot y abre /api/admin/telegram/vincular).
// ---------------------------------------------------------------------------

const CLAVE = 'telegram_resumenes'

export async function chatsTelegram(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('app_settings').select('value').eq('key', CLAVE).maybeSingle()
  const guardados = ((data?.value as { chat_ids?: string[] } | null)?.chat_ids ?? []).map(String)
  const env = (process.env.TELEGRAM_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return [...new Set([...guardados, ...env])]
}

export async function guardarChatsTelegram(admin: SupabaseClient, chatIds: string[], userId: string | null): Promise<void> {
  await admin.from('app_settings').upsert({ key: CLAVE, value: { chat_ids: [...new Set(chatIds)] }, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export async function llamarTelegram<T = unknown>(metodo: string, body?: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en Vercel')
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string }
  if (!r.ok || !j.ok) throw new Error(j.description ?? `Telegram respondió ${r.status}`)
  return j.result as T
}

export async function enviarTelegram(admin: SupabaseClient, texto: string): Promise<{ ok: boolean; enviados: number; error?: string }> {
  const chats = await chatsTelegram(admin)
  if (!chats.length) return { ok: false, enviados: 0, error: 'No hay chats vinculados' }
  let enviados = 0
  const errores: string[] = []
  for (const chat_id of chats) {
    try {
      await llamarTelegram('sendMessage', { chat_id, text: texto, parse_mode: 'HTML', disable_web_page_preview: true })
      enviados++
    } catch (err) {
      errores.push(err instanceof Error ? err.message : 'Error')
    }
  }
  return { ok: enviados > 0, enviados, error: errores[0] }
}
