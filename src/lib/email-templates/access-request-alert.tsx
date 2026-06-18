import * as React from 'react'
import {
  Body,
  Button,
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

interface AccessRequestAlertProps {
  fullName?: string
  email?: string
  company?: string
  requestedRole?: string
  reviewUrl?: string
}

const AccessRequestAlertEmail = ({
  fullName,
  email,
  company,
  requestedRole,
  reviewUrl,
}: AccessRequestAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
      <Preview>New access request for {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New access request</Heading>
          <Text style={text}>
            Someone just signed up and is waiting for approval.
          </Text>
          <Section style={detailsBox}>
            <Text style={detailRow}>
              <strong>Name:</strong> {fullName || '—'}
            </Text>
            <Text style={detailRow}>
              <strong>Email:</strong> {email || '—'}
            </Text>
            <Text style={detailRow}>
              <strong>Company:</strong> {company || '—'}
            </Text>
            <Text style={detailRow}>
              <strong>Requested role:</strong> {requestedRole || '—'}
            </Text>
          </Section>
          {reviewUrl ? (
            <Section style={{ textAlign: 'center', margin: '0 0 20px' }}>
              <Button href={reviewUrl} style={button}>
                Review request
              </Button>
            </Section>
          ) : null}
          <Text style={text}>
            Review and approve from the users page in the admin dashboard.
          </Text>
          <Text style={footer}>— {SITE_NAME}</Text>
        </Container>
      </Body>
  </Html>
)

export const template = {
  component: AccessRequestAlertEmail,
  subject: 'New access request — Jet Leads',
  displayName: 'Access request alert',
  previewData: {
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    company: 'Acme Call Center',
    requestedRole: 'vendor',
    reviewUrl: 'https://example.com/admin',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.5', margin: '0 0 16px' }
const detailsBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '16px',
  margin: '0 0 20px',
}
const detailRow = { fontSize: '14px', color: '#0f172a', margin: '0 0 8px' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 'bold',
  textDecoration: 'none',
  display: 'inline-block',
}