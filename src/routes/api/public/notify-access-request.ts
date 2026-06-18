import * as React from 'react'
import { render } from '@react-email/components'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'jet-leads'
const SENDER_DOMAIN = 'notify.anchorlineinsurance.com'
const FROM_DOMAIN = 'notify.anchorlineinsurance.com'
const TEMPLATE_NAME = 'access-request-alert'

const Schema = z.object({
  email: z.string().email().max(255),
  fullName: z.string().min(1).max(200).optional(),
  company: z.string().max(200).optional(),
  requestedRole: z.string().max(50).optional(),
})

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const Route = createFileRoute('/api/public/notify-access-request')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        let parsed
        try {
          parsed = Schema.parse(await request.json())
        } catch {
          return Response.json({ error: 'Invalid payload' }, { status: 400 })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Abuse guard: only send if a profile with this email was created in the last 5 minutes.
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, created_at')
          .eq('email', parsed.email)
          .gte('created_at', fiveMinAgo)
          .maybeSingle()

        if (!profile) {
          return Response.json({ success: false, reason: 'no_recent_signup' })
        }

        const template = TEMPLATES[TEMPLATE_NAME]
        if (!template) {
          return Response.json({ error: 'Template missing' }, { status: 500 })
        }

        // Build absolute review URL from this request's origin.
        const origin = new URL(request.url).origin
        const reviewUrl = `${origin}/admin`

        // Find every admin who has not opted out of access-request emails.
        const { data: adminRoleRows } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin')
        const adminIds = (adminRoleRows ?? []).map((r) => r.user_id)
        if (adminIds.length === 0) {
          return Response.json({ success: false, reason: 'no_admins' })
        }
        const { data: adminProfiles } = await supabase
          .from('profiles')
          .select('id, email, notification_prefs')
          .in('id', adminIds)

        const recipients = (adminProfiles ?? [])
          .filter((p) => {
            if (!p.email) return false
            const prefs = (p.notification_prefs ?? {}) as Record<string, unknown>
            return prefs.access_request_email !== false
          })
          .map((p) => p.email as string)

        if (recipients.length === 0) {
          return Response.json({ success: false, reason: 'no_opted_in_admins' })
        }

        let sent = 0
        let skipped = 0
        for (const recipient of recipients) {
          const normalizedEmail = recipient.toLowerCase()

          // Suppression check (per-recipient)
          const { data: suppressed } = await supabase
            .from('suppressed_emails')
            .select('id')
            .eq('email', normalizedEmail)
            .maybeSingle()
          if (suppressed) {
            skipped += 1
            continue
          }

          // Unsubscribe token (one per email)
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
                { onConflict: 'email', ignoreDuplicates: true },
              )
            const { data: stored } = await supabase
              .from('email_unsubscribe_tokens')
              .select('token')
              .eq('email', normalizedEmail)
              .maybeSingle()
            if (stored) unsubscribeToken = stored.token
          }

          const templateData = {
            fullName: parsed.fullName,
            email: parsed.email,
            company: parsed.company,
            requestedRole: parsed.requestedRole,
            reviewUrl,
          }

          const element = React.createElement(template.component, templateData)
          const html = await render(element)
          const plainText = await render(element, { plainText: true })
          const subject =
            typeof template.subject === 'function'
              ? template.subject(templateData)
              : template.subject

          const messageId = `access-request-${profile.id}-${normalizedEmail}`

          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: recipient,
            status: 'pending',
          })

          const { error: enqueueError } = await supabase.rpc('enqueue_email', {
            queue_name: 'transactional_emails',
            payload: {
              message_id: messageId,
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
              queued_at: new Date().toISOString(),
            },
          })

          if (enqueueError) {
            await supabase.from('email_send_log').insert({
              message_id: messageId,
              template_name: TEMPLATE_NAME,
              recipient_email: recipient,
              status: 'failed',
              error_message: 'Failed to enqueue email',
            })
            skipped += 1
            continue
          }

          sent += 1
        }

        return Response.json({ success: true, sent, skipped })
      },
    },
  },
})