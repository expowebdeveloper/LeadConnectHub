import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { sendLovableEmail } from '@lovable.dev/email-js'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'jet-leads'
const SENDER_DOMAIN = 'notify.anchorlineinsurance.com'
const FROM_DOMAIN = 'notify.anchorlineinsurance.com'
const TEMPLATE_NAME = 'email-health-alert'
const ALERT_COOLDOWN_MIN = 30
const STALL_THRESHOLD_MIN = 3

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const Route = createFileRoute('/api/public/hooks/email-health')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Require the Supabase anon/publishable key in an `apikey` header.
        // This is the same auth pattern pg_cron uses for its scheduled calls.
        const expectedApiKey =
          process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        const providedApiKey = request.headers.get('apikey') ?? ''
        if (!expectedApiKey || providedApiKey !== expectedApiKey) {
          return new Response('Unauthorized', { status: 401 })
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        const apiKey = process.env.LOVABLE_API_KEY
        if (!supabaseUrl || !supabaseServiceKey || !apiKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // 1. Check queue stall + depths via SECURITY DEFINER RPC.
        const { data: healthRows, error: healthErr } = await supabase.rpc(
          'email_queue_health',
          { stall_minutes: STALL_THRESHOLD_MIN }
        )
        if (healthErr) {
          console.error('email_queue_health rpc failed', healthErr)
          return Response.json({ error: 'health probe failed' }, { status: 500 })
        }
        const health = (healthRows as {
          auth_depth: number
          transactional_depth: number
          stalled_count: number
          oldest_age_seconds: number
        }) || { auth_depth: 0, transactional_depth: 0, stalled_count: 0, oldest_age_seconds: 0 }

        // 2. Count recent DLQ entries (new failures in last 15 min).
        const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
        const { count: dlqCount } = await supabase
          .from('email_send_log')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'dlq')
          .gte('created_at', fifteenMinAgo)
        const recentDlqCount = dlqCount ?? 0

        const unhealthy = health.stalled_count > 0 || recentDlqCount > 0

        if (!unhealthy) {
          return Response.json({ healthy: true, ...health, recentDlqCount })
        }

        // 3. Cooldown — don't spam.
        const { data: setting } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'email_health_alert')
          .maybeSingle()
        const lastAlertedAt = (setting?.value as { last_alerted_at?: string } | null)
          ?.last_alerted_at
        if (lastAlertedAt) {
          const ageMin = (Date.now() - new Date(lastAlertedAt).getTime()) / 60000
          if (ageMin < ALERT_COOLDOWN_MIN) {
            return Response.json({
              healthy: false,
              alerted: false,
              reason: 'cooldown',
              cooldown_remaining_min: Math.round(ALERT_COOLDOWN_MIN - ageMin),
              ...health,
              recentDlqCount,
            })
          }
        }

        // 4. Render & send directly (bypass queue, since queue itself may be broken).
        const template = TEMPLATES[TEMPLATE_NAME]
        const recipient = template?.to
        if (!template || !recipient) {
          return Response.json({ error: 'Template missing' }, { status: 500 })
        }

        const { data: suppressed } = await supabase
          .from('suppressed_emails')
          .select('id')
          .eq('email', recipient.toLowerCase())
          .maybeSingle()
        if (suppressed) {
          return Response.json({ healthy: false, alerted: false, reason: 'suppressed' })
        }

        const normalizedEmail = recipient.toLowerCase()
        let unsubscribeToken: string
        const { data: existing } = await supabase
          .from('email_unsubscribe_tokens')
          .select('token, used_at')
          .eq('email', normalizedEmail)
          .maybeSingle()
        if (existing && !existing.used_at) {
          unsubscribeToken = existing.token
        } else {
          unsubscribeToken = generateToken()
          await supabase
            .from('email_unsubscribe_tokens')
            .upsert(
              { token: unsubscribeToken, email: normalizedEmail },
              { onConflict: 'email', ignoreDuplicates: true }
            )
        }

        const templateData = {
          stalledCount: health.stalled_count,
          oldestAgeMinutes: Math.round(health.oldest_age_seconds / 60),
          recentDlqCount,
          authQueueDepth: health.auth_depth,
          transactionalQueueDepth: health.transactional_depth,
          detectedAt: new Date().toISOString(),
        }

        const element = React.createElement(template.component, templateData)
        const html = await render(element)
        const plainText = await render(element, { plainText: true })
        const subject =
          typeof template.subject === 'function'
            ? template.subject(templateData)
            : template.subject

        const messageId = `email-health-${Date.now()}`

        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: TEMPLATE_NAME,
          recipient_email: recipient,
          status: 'pending',
        })

        try {
          await sendLovableEmail(
            {
              to: recipient,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text: plainText,
              purpose: 'transactional',
              label: TEMPLATE_NAME,
              idempotency_key: messageId,
              unsubscribe_token: unsubscribeToken,
              message_id: messageId,
            },
            { apiKey, sendUrl: process.env.LOVABLE_SEND_URL }
          )

          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: recipient,
            status: 'sent',
          })

          await supabase.from('app_settings').upsert(
            {
              key: 'email_health_alert',
              value: {
                last_alerted_at: new Date().toISOString(),
                last_payload: templateData,
              },
            },
            { onConflict: 'key' }
          )

          return Response.json({ healthy: false, alerted: true, ...templateData })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.error('Failed to send email-health alert', msg)
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: recipient,
            status: 'failed',
            error_message: msg,
          })
          return Response.json({ error: 'send failed', detail: msg }, { status: 500 })
        }
      },
    },
  },
})