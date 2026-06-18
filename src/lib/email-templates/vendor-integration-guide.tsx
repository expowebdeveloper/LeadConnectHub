import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Jet Leads'

interface Props {
  vendorName?: string
  contactName?: string
  postUrl?: string
}

const sampleBody = `{
  "first_name": "Jane",
  "last_name": "Doe",
  "phone": "5555550123",
  "state": "FL",
  "current_carrier": "Geico",
  "email": "jane@example.com",
  "date_of_birth": "1985-04-12",
  "street": "123 Main St",
  "city": "Tampa",
  "zip": "33602",
  "county": "Hillsborough",
  "num_vehicles": 2,
  "vehicles": [
    { "year": "2019", "make": "Toyota", "model": "Camry" },
    { "year": "2021", "make": "Honda", "model": "Civic" }
  ],
  "lead_types": ["auto"],
  "vendor_notes": "Interested in lower rate"
}`

const VendorIntegrationGuide = ({ vendorName, contactName, postUrl }: Props) => {
  const url = postUrl || 'https://jet-leads.lovable.app/api/public/leads/post/<YOUR_TOKEN>'
  const curl = `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '${sampleBody.replace(/\n/g, ' ')}'`
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{SITE_NAME} lead posting integration guide</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Lead posting integration</Heading>
          <Text style={text}>
            {contactName ? `Hi ${contactName},` : 'Hello,'} thanks for partnering with {SITE_NAME}
            {vendorName ? ` as ${vendorName}` : ''}. Below is everything your team needs to start
            posting leads into our system.
          </Text>

          <Section style={callout}>
            <Text style={calloutLabel}>Your posting URL</Text>
            <Text style={code}>{url}</Text>
            <Text style={small}>
              Keep this URL private. The token in the URL authenticates your account. If it is ever
              exposed, contact us and we will rotate it.
            </Text>
          </Section>

          <Heading as="h2" style={h2}>1. Endpoint</Heading>
          <Text style={text}>
            <strong>Method:</strong> POST<br />
            <strong>Content-Type:</strong> application/json<br />
            <strong>Auth:</strong> Token in URL (no headers required)
          </Text>

          <Heading as="h2" style={h2}>2. Required fields</Heading>
          <Text style={text}>
            <code style={inlineCode}>first_name</code> · <code style={inlineCode}>last_name</code> ·{' '}
            <code style={inlineCode}>phone</code> (10 digits, US) ·{' '}
            <code style={inlineCode}>state</code> (2-letter) ·{' '}
            <code style={inlineCode}>current_carrier</code>
          </Text>

          <Heading as="h2" style={h2}>3. Optional fields</Heading>
          <Text style={text}>
            <code style={inlineCode}>email</code> · <code style={inlineCode}>date_of_birth</code>{' '}
            (YYYY-MM-DD) · <code style={inlineCode}>street</code> ·{' '}
            <code style={inlineCode}>city</code> · <code style={inlineCode}>zip</code> ·{' '}
            <code style={inlineCode}>county</code> · <code style={inlineCode}>num_vehicles</code> ·{' '}
            <code style={inlineCode}>vehicles[]</code> (each with{' '}
            <code style={inlineCode}>year</code>, <code style={inlineCode}>make</code>,{' '}
            <code style={inlineCode}>model</code>; flat aliases{' '}
            <code style={inlineCode}>vehicle1_year</code>,{' '}
            <code style={inlineCode}>vehicle1_make</code>,{' '}
            <code style={inlineCode}>vehicle1_model</code> also accepted) ·{' '}
            <code style={inlineCode}>current_home_carrier</code> ·{' '}
            <code style={inlineCode}>housing_status</code> ·{' '}
            <code style={inlineCode}>lead_types[]</code> (e.g. <em>auto</em>, <em>home</em>) ·{' '}
            <code style={inlineCode}>vendor_notes</code> ·{' '}
            <code style={inlineCode}>lead_source</code>
          </Text>

          <Heading as="h2" style={h2}>4. Example request</Heading>
          <pre style={pre}>{curl}</pre>

          <Heading as="h2" style={h2}>5. Example payload</Heading>
          <pre style={pre}>{sampleBody}</pre>

          <Heading as="h2" style={h2}>6. Responses</Heading>
          <Text style={text}>
            <strong>201 Created</strong> — Lead accepted. Body contains the new lead id.<br />
            <strong>400 Bad Request</strong> — Validation failed. Body lists the invalid fields.<br />
            <strong>401 Unauthorized</strong> — Token is invalid or disabled.<br />
            <strong>429 Too Many Requests</strong> — Slow down and retry.<br />
            <strong>5xx</strong> — Server error. Safe to retry with the same payload.
          </Text>

          <Heading as="h2" style={h2}>7. Best practices</Heading>
          <Text style={text}>
            • Post leads in real time — they are routed to our live queue (Shark Tank) immediately.<br />
            • Send one lead per request.<br />
            • Normalize phone numbers to 10 digits (no formatting).<br />
            • Include <code style={inlineCode}>vendor_notes</code> with any context your reps captured.<br />
            • Retry idempotently on 5xx and 429 with exponential backoff.
          </Text>

          <Hr style={hr} />
          <Text style={footer}>
            Questions? Just reply to this email and our team will get back to you.<br />
            — {SITE_NAME}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: VendorIntegrationGuide,
  subject: ({ vendorName }: Record<string, any>) =>
    `${SITE_NAME} — lead posting integration${vendorName ? ` for ${vendorName}` : ''}`,
  displayName: 'Vendor integration guide',
  previewData: {
    vendorName: 'Acme Call Center',
    contactName: 'Jane',
    postUrl: 'https://jet-leads.lovable.app/api/public/leads/post/abc123token',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '640px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const h2 = { fontSize: '16px', fontWeight: 'bold', color: '#0f172a', margin: '24px 0 8px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.6', margin: '0 0 12px' }
const small = { fontSize: '12px', color: '#64748b', lineHeight: '1.5', margin: '8px 0 0' }
const callout = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '16px',
  margin: '0 0 16px',
}
const calloutLabel = { fontSize: '12px', fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 6px' }
const code = { fontSize: '13px', fontFamily: 'Menlo, Consolas, monospace', color: '#0f172a', wordBreak: 'break-all' as const, margin: '0' }
const inlineCode = { fontFamily: 'Menlo, Consolas, monospace', fontSize: '12px', backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: '3px', color: '#0f172a' }
const pre = { backgroundColor: '#0f172a', color: '#e2e8f0', padding: '14px', borderRadius: '8px', fontSize: '12px', fontFamily: 'Menlo, Consolas, monospace', overflow: 'auto' as const, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0' }