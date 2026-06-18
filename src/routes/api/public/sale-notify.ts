import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'jet-leads'
const SENDER_DOMAIN = 'notify.anchorlineinsurance.com'
const FROM_DOMAIN = 'notify.anchorlineinsurance.com'

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function generateToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function etDayStartUtc(now = new Date()): string {
  // Start of "today" in America/New_York, expressed as a UTC ISO string.
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // YYYY-MM-DD
  const etWall = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const utcWall = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMs = etWall.getTime() - utcWall.getTime()
  const midnightUtcNaive = new Date(`${dateStr}T00:00:00Z`).getTime()
  return new Date(midnightUtcNaive - offsetMs).toISOString()
}

export const Route = createFileRoute('/api/public/sale-notify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
          return new Response('Server misconfigured', { status: 500 })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Load stored webhook secret
        const { data: setting, error: settingErr } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'sale_webhook')
          .maybeSingle()
        if (settingErr || !setting?.value?.secret) {
          return new Response('Webhook not configured', { status: 500 })
        }
        const expectedSecret: string = setting.value.secret
        const providedSecret = request.headers.get('x-sale-secret') ?? ''
        if (!timingSafeEqualStr(providedSecret, expectedSecret)) {
          return new Response('Unauthorized', { status: 401 })
        }

        let eventId: string
        try {
          const body = await request.json()
          eventId = String(body.event_id || '')
        } catch {
          return new Response('Invalid JSON', { status: 400 })
        }
        if (!eventId) return new Response('event_id required', { status: 400 })

        // Load the sale event
        const { data: evt, error: evtErr } = await supabase
          .from('sale_events')
          .select('*')
          .eq('id', eventId)
          .maybeSingle()
        if (evtErr || !evt) return new Response('Event not found', { status: 404 })

        // Resolve a signed URL for the closer's avatar (private bucket) so
        // the email can display the headshot inline.
        let agentAvatarUrl: string | null = null
        const avatarPath = (evt as any).agent_avatar_url as string | null
        if (avatarPath) {
          const { data: signed } = await supabase
            .storage
            .from('avatars')
            .createSignedUrl(avatarPath, 60 * 60 * 24 * 7)
          agentAvatarUrl = signed?.signedUrl ?? null
        }

        // Build today's leaderboard (Eastern Time day)
        const dayStart = etDayStartUtc()
        const { data: todaysSales } = await supabase
          .from('sale_events')
          .select('agent_id, agent_name, premium')
          .gte('created_at', dayStart)

        const byAgent = new Map<string, { agent_name: string; sales: number; premium: number }>()
        for (const row of todaysSales ?? []) {
          const key = row.agent_id ?? row.agent_name ?? 'unknown'
          const cur = byAgent.get(key) || { agent_name: row.agent_name || 'Unknown', sales: 0, premium: 0 }
          cur.sales += 1
          cur.premium += Number(row.premium ?? 0) || 0
          byAgent.set(key, cur)
        }
        const leaderboard = Array.from(byAgent.values())
          .sort((a, b) => b.premium - a.premium || b.sales - a.sales)
          .slice(0, 10)
        const totalSales = (todaysSales ?? []).length
        const totalPremium = (todaysSales ?? []).reduce((s, r) => s + (Number(r.premium ?? 0) || 0), 0)

        // Team goal (agency-scope premium goal). Prefer daily; fall back to
        // monthly/22 or weekly/4; final fallback 250000.
        let teamGoalPremium = 250000
        try {
          const { data: goalRows } = await supabase
            .from('goals')
            .select('period, target')
            .eq('scope', 'agency')
            .eq('metric', 'premium')
          const byPeriod = new Map<string, number>()
          for (const g of goalRows ?? []) byPeriod.set(g.period as string, Number(g.target) || 0)
          if (byPeriod.get('daily')) teamGoalPremium = byPeriod.get('daily')!
          else if (byPeriod.get('weekly')) teamGoalPremium = Math.round(byPeriod.get('weekly')! / 5)
          else if (byPeriod.get('monthly')) teamGoalPremium = Math.round(byPeriod.get('monthly')! / 22)
        } catch { /* keep fallback */ }

        // Yesterday's premium total (previous ET day)
        let yesterdayPremium = 0
        try {
          const todayMs = new Date(dayStart).getTime()
          const yesterdayStart = new Date(todayMs - 24 * 60 * 60 * 1000).toISOString()
          const { data: yRows } = await supabase
            .from('sale_events')
            .select('premium')
            .gte('created_at', yesterdayStart)
            .lt('created_at', dayStart)
          yesterdayPremium = (yRows ?? []).reduce(
            (s, r) => s + (Number((r as any).premium ?? 0) || 0),
            0,
          )
        } catch { /* non-fatal */ }

        // Resolve recipients: all admins + sales agents
        const { data: roleRows, error: roleErr } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in('role', ['admin', 'sales'])
        if (roleErr) {
          console.error('Failed to load recipient roles', roleErr)
          return new Response('Failed to load recipients', { status: 500 })
        }
        const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)))
        if (userIds.length === 0) return Response.json({ success: true, sent: 0 })

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, notification_prefs')
          .in('id', userIds)

        const recipients = (profiles ?? [])
          .filter((p: any) => {
            const prefs = p.notification_prefs || {}
            // Default to opted-in unless explicitly false
            return prefs.sale_email !== false
          })
          .map((p) => (p.email || '').toLowerCase())
          .filter((e) => !!e && /^[^@]+@[^@]+\.[^@]+$/.test(e))

        // Pre-render the template once with shared data; recipient-specific
        // unsubscribe footer is appended by the queue processor.
        const template = TEMPLATES['sale-leaderboard']
        if (!template) return new Response('Template missing', { status: 500 })

        const templateData = {
          agentName: evt.agent_name || 'An agent',
          agentAvatarUrl,
          leadName: evt.lead_name || 'a lead',
          premium: evt.premium != null ? Number(evt.premium) : null,
          side: evt.side,
          vehicles:
            (evt as any).items_count != null
              ? Number((evt as any).items_count)
              : (evt as any).vehicles != null
                ? Number((evt as any).vehicles)
                : null,
          items:
            (evt as any).items_count != null ? Number((evt as any).items_count) : null,
          source: (evt as any).source ?? null,
          leaderboard,
          totalSales,
          totalPremium,
          teamGoalPremium,
          yesterdayPremium,
          dateLabel: 'Today (Eastern Time)',
        }

        const element = React.createElement(template.component as any, templateData)
        const html = await render(element)
        const plainText = await render(element, { plainText: true })
        const subject =
          typeof template.subject === 'function'
            ? template.subject(templateData)
            : template.subject

        // Check suppression once
        const { data: suppressedRows } = await supabase
          .from('suppressed_emails')
          .select('email')
          .in('email', recipients)
        const suppressed = new Set((suppressedRows ?? []).map((r: any) => r.email))

        let sent = 0
        for (const to of recipients) {
          if (suppressed.has(to)) continue

          // Get or create unsubscribe token for this recipient
          let unsubscribeToken: string | null = null
          const { data: existingToken } = await supabase
            .from('email_unsubscribe_tokens')
            .select('token, used_at')
            .eq('email', to)
            .maybeSingle()
          if (existingToken && !existingToken.used_at) {
            unsubscribeToken = existingToken.token
          } else if (!existingToken) {
            unsubscribeToken = generateToken()
            await supabase
              .from('email_unsubscribe_tokens')
              .upsert({ token: unsubscribeToken, email: to }, { onConflict: 'email', ignoreDuplicates: true })
            const { data: reread } = await supabase
              .from('email_unsubscribe_tokens')
              .select('token')
              .eq('email', to)
              .maybeSingle()
            if (reread?.token) unsubscribeToken = reread.token
          } else {
            continue // token used but not suppressed; safety skip
          }

          const messageId = crypto.randomUUID()
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: 'sale-leaderboard',
            recipient_email: to,
            status: 'pending',
          })

          const { error: enqueueError } = await supabase.rpc('enqueue_email', {
            queue_name: 'transactional_emails',
            payload: {
              message_id: messageId,
              to,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text: plainText,
              purpose: 'transactional',
              label: 'sale-leaderboard',
              idempotency_key: `sale-${eventId}-${to}`,
              unsubscribe_token: unsubscribeToken,
              queued_at: new Date().toISOString(),
            },
          })

          if (enqueueError) {
            console.error('Failed to enqueue sale-leaderboard email', enqueueError)
            await supabase.from('email_send_log').insert({
              message_id: messageId,
              template_name: 'sale-leaderboard',
              recipient_email: to,
              status: 'failed',
              error_message: 'Failed to enqueue email',
            })
            continue
          }
          sent += 1
        }

        return Response.json({ success: true, sent, total_recipients: recipients.length })
      },
    },
  },
})