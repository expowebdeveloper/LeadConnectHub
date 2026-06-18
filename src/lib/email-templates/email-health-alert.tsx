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
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Jet Leads'

export interface EmailHealthAlertProps {
  stalledCount?: number
  oldestAgeMinutes?: number
  recentDlqCount?: number
  authQueueDepth?: number
  transactionalQueueDepth?: number
  detectedAt?: string
}

const EmailHealthAlertEmail = ({
  stalledCount = 0,
  oldestAgeMinutes = 0,
  recentDlqCount = 0,
  authQueueDepth = 0,
  transactionalQueueDepth = 0,
  detectedAt,
}: EmailHealthAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Email queue health alert — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Email queue is unhealthy</Heading>
        <Text style={text}>
          The email queue processor appears to be stalled or repeatedly failing.
        </Text>
        <Section style={box}>
          <Text style={row}>
            <strong>Stalled messages (&gt; 3 min):</strong> {stalledCount}
          </Text>
          <Text style={row}>
            <strong>Oldest pending message age:</strong> {oldestAgeMinutes} min
          </Text>
          <Text style={row}>
            <strong>Auth queue depth:</strong> {authQueueDepth}
          </Text>
          <Text style={row}>
            <strong>Transactional queue depth:</strong> {transactionalQueueDepth}
          </Text>
          <Text style={row}>
            <strong>New DLQ entries (last 15 min):</strong> {recentDlqCount}
          </Text>
          <Text style={row}>
            <strong>Detected at:</strong> {detectedAt}
          </Text>
        </Section>
        <Text style={text}>
          Common causes: queue processor returning 403/401 after a service-role
          key rotation, missing pg_cron job, or email provider outage.
        </Text>
        <Text style={muted}>
          You won't get another alert for at least 30 minutes.
        </Text>
      </Container>
    </Body>
  </Html>
)

const main = { backgroundColor: '#f6f9fc', fontFamily: 'system-ui, sans-serif' }
const container = { margin: '0 auto', padding: '24px', maxWidth: '560px' }
const h1 = { color: '#b91c1c', fontSize: '22px', margin: '0 0 16px' }
const text = { color: '#1f2937', fontSize: '15px', lineHeight: '22px' }
const muted = { color: '#6b7280', fontSize: '13px', marginTop: '24px' }
const box = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
}
const row = { color: '#1f2937', fontSize: '14px', margin: '4px 0' }

export const template: TemplateEntry = {
  component: EmailHealthAlertEmail,
  subject: '🚨 Email queue health alert',
  displayName: 'Email Health Alert',
  to: 'britfosh@gmail.com',
  previewData: {
    stalledCount: 12,
    oldestAgeMinutes: 8,
    recentDlqCount: 3,
    authQueueDepth: 0,
    transactionalQueueDepth: 12,
    detectedAt: new Date().toISOString(),
  },
}

export default EmailHealthAlertEmail