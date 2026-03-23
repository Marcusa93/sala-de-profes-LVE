import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/expedientes/[id]/tasks — list tasks
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('expediente_tasks')
      .select('*, assignee:assigned_to(first_name, last_name, role), creator:created_by(first_name, last_name, role)')
      .eq('expediente_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/expedientes/[id]/tasks — create task + notify
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Only socios can create tasks
    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'socio') {
      return NextResponse.json({ error: 'Solo los socios pueden crear tareas' }, { status: 403 })
    }

    const body = await request.json()
    const { title, description, assigned_to, due_date } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Título requerido' }, { status: 400 })
    }

    // Get expediente code for notification
    const { data: exp } = await admin
      .from('expedientes')
      .select('code, title')
      .eq('id', id)
      .single()

    // Create task
    const { data: task, error } = await admin
      .from('expediente_tasks')
      .insert({
        expediente_id: id,
        title: title.trim(),
        description: description?.trim() || null,
        assigned_to: assigned_to || null,
        due_date: due_date || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    // Log as comment on the expediente
    const assigneeName = assigned_to ? await getProfileName(admin, assigned_to) : null
    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'edit',
      body: `Nueva tarea: "${title.trim()}"${assigneeName ? ` → asignada a ${assigneeName}` : ''}`,
      metadata: { action: 'task_created', task_id: task.id },
    })

    // Notify assignee
    if (assigned_to && assigned_to !== user.id) {
      const authorName = `${profile.first_name} ${profile.last_name}`.trim()
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'media',
        title: `📌 Tarea asignada — ${exp?.code ?? ''}`,
        body: `${authorName} te asignó: "${title.trim()}"${due_date ? ` · Vence: ${new Date(due_date).toLocaleDateString('es-AR')}` : ''}`,
        scope: 'user',
        target_user_id: assigned_to,
        is_active: true,
      })
    }

    return NextResponse.json({ data: task })
  } catch (err) {
    console.error('[POST /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/expedientes/[id]/tasks — update task status
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const body = await request.json()
    const { task_id, status } = body

    if (!task_id || !status) {
      return NextResponse.json({ error: 'task_id y status requeridos' }, { status: 400 })
    }

    const validStatuses = ['pending', 'in_progress', 'done', 'cancelled']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    }

    // Get current task
    const { data: task } = await admin
      .from('expediente_tasks')
      .select('title, assigned_to, status')
      .eq('id', task_id)
      .single()

    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

    // Update
    const { error } = await admin
      .from('expediente_tasks')
      .update({ status })
      .eq('id', task_id)

    if (error) throw error

    // Log status change
    const statusLabels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      done: 'Completada',
      cancelled: 'Cancelada',
    }
    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'edit',
      body: `Tarea "${task.title}" → ${statusLabels[status]}`,
      metadata: { action: 'task_status_change', task_id, from: task.status, to: status },
    })

    // Get expediente info for notification
    const { data: exp } = await admin
      .from('expedientes')
      .select('code, author_id, responsible_id')
      .eq('id', id)
      .single()

    // Notify relevant people about task completion
    if (status === 'done' && exp) {
      const { data: updater } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single()
      const updaterName = updater ? `${updater.first_name} ${updater.last_name}`.trim() : 'Alguien'

      // Notify expediente author and responsible (if different from updater)
      const notifyIds = new Set<string>()
      if (exp.author_id && exp.author_id !== user.id) notifyIds.add(exp.author_id)
      if (exp.responsible_id && exp.responsible_id !== user.id) notifyIds.add(exp.responsible_id)

      for (const targetId of notifyIds) {
        await admin.from('announcements').insert({
          author_id: user.id,
          type: 'operativo',
          priority: 'baja',
          title: `✅ Tarea completada — ${exp.code}`,
          body: `${updaterName} completó: "${task.title}"`,
          scope: 'user',
          target_user_id: targetId,
          is_active: true,
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getProfileName(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).single()
  return data ? `${data.first_name} ${data.last_name}`.trim() : null
}
