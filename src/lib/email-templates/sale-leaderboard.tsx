import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Row,
  Column,
  Text,
  Img,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'LeadVault'

export interface LeaderboardRow {
  agent_name: string
  sales: number
  premium: number
}

interface SaleLeaderboardProps {
  agentName?: string
  agentAvatarUrl?: string | null
  leadName?: string
  premium?: number | null
  side?: 'auto' | 'home' | 'motorcycle' | 'boat' | 'umbrella' | 'flood' | 'golf_cart'
  vehicles?: number | null
  items?: number | null
  source?: string | null
  leaderboard?: LeaderboardRow[]
  totalSales?: number
  totalPremium?: number
  dateLabel?: string
  teamGoalPremium?: number | null
  yesterdayPremium?: number | null
}

const fmtMoney = (n: number | null | undefined) =>
  typeof n === 'number' && !Number.isNaN(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : '—'

const firstName = (name?: string) => (name || '').trim().split(/\s+/)[0] || 'Agent'
const policyLabel = (side?: string) => {
  switch (side) {
    case 'home': return 'Home'
    case 'auto': return 'Auto'
    case 'motorcycle': return 'Motorcycle'
    case 'boat': return 'Boat'
    case 'umbrella': return 'Umbrella'
    case 'flood': return 'Flood'
    case 'golf_cart': return 'Golf Cart'
    default: return 'Policy'
  }
}

const policyEmoji = (side?: string) => {
  switch (side) {
    case 'home': return '🏠'
    case 'motorcycle': return '🏍️'
    case 'boat': return '⛵'
    case 'umbrella': return '☂️'
    case 'flood': return '🌊'
    case 'golf_cart': return '🏌️'
    case 'rv': return '🚐'
    default: return '🚗'
  }
}

const itemUnit = (side: string | undefined, n: number) => {
  if (side === 'auto') return n === 1 ? 'VEHICLE' : 'VEHICLES'
  if (side === 'home') return n === 1 ? 'DWELLING' : 'DWELLINGS'
  if (side === 'boat') return n === 1 ? 'BOAT' : 'BOATS'
  if (side === 'motorcycle') return n === 1 ? 'MOTORCYCLE' : 'MOTORCYCLES'
  if (side === 'golf_cart') return n === 1 ? 'GOLF CART' : 'GOLF CARTS'
  if (side === 'rv') return n === 1 ? 'RV' : 'RVs'
  if (side === 'umbrella' || side === 'flood') return n === 1 ? 'POLICY' : 'POLICIES'
  return n === 1 ? 'ITEM' : 'ITEMS'
}

function initialsOf(name?: string) {
  const n = (name || '').trim()
  if (!n) return '?'
  const parts = n.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || n[0].toUpperCase()
}

function hueOf(name?: string) {
  const s = (name || '?').toLowerCase()
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function AvatarCircle({ name, url, size = 96 }: { name?: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      <Img
        src={url}
        alt={name || 'Agent'}
        width={size}
        height={size}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '9999px',
          objectFit: 'cover',
          border: '3px solid #3DFF63',
          boxShadow: '0 0 0 6px rgba(61,255,99,.18), 0 8px 30px rgba(61,255,99,.35)',
          display: 'block',
          margin: '0 auto',
        }}
      />
    )
  }
  void hueOf
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        lineHeight: `${size}px`,
        textAlign: 'center' as const,
        borderRadius: '9999px',
        backgroundColor: '#0B2212',
        color: '#3DFF63',
        fontWeight: 700,
        fontSize: `${Math.round(size * 0.36)}px`,
        border: '3px solid #3DFF63',
        boxShadow: '0 0 0 6px rgba(61,255,99,.18), 0 8px 30px rgba(61,255,99,.35)',
        margin: '0 auto',
      }}
    >
      {initialsOf(name)}
    </div>
  )
}

const SaleLeaderboardEmail = ({
  agentName,
  agentAvatarUrl,
  premium,
  side,
  vehicles,
  items,
  source,
  leaderboard = [],
  totalSales = 0,
  totalPremium = 0,
  dateLabel,
  teamGoalPremium,
  yesterdayPremium,
}: SaleLeaderboardProps) => {
  const agentFirst = firstName(agentName)
  const policy = policyLabel(side)
  const itemCount = Math.max(1, Number(items ?? vehicles ?? 1) || 1)
  const top3 = (leaderboard || []).slice(0, 3)
  const meIdx = (leaderboard || []).findIndex((r) => firstName(r.agent_name) === agentFirst)
  const meRank = meIdx >= 0 ? meIdx + 1 : null
  const goal = typeof teamGoalPremium === 'number' && teamGoalPremium > 0 ? teamGoalPremium : 250000
  const goalPct = Math.max(0, Math.min(100, Math.round(((totalPremium || 0) / goal) * 100)))
  const yesterday = typeof yesterdayPremium === 'number' ? yesterdayPremium : null
  const needToBeat = yesterday != null ? Math.max(0, yesterday - (totalPremium || 0)) : null
  const aheadOfYesterday = yesterday != null && (totalPremium || 0) > yesterday

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>🔥 {agentFirst} closed one — {fmtMoney(premium)} {policy}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={darkCard}>
            {/* Header */}
            <Row style={headerRow}>
              <Column>
                <Text style={brandText}>
                  <span style={brandLock}>◆</span> {SITE_NAME}
                </Text>
              </Column>
              <Column align="right">
                <Text style={brandPill}>🔔 SALES ALERT</Text>
              </Column>
            </Row>
            <div style={divider} />

            {/* Hero */}
            <Section style={heroSection}>
              <AvatarCircle name={agentName} url={agentAvatarUrl} size={96} />
              <Heading style={h1}>🔥 {agentFirst.toUpperCase()} CLOSED ONE!</Heading>
            </Section>

            {/* Policy Badge Bar */}
            <Section style={badgeBar}>
              <Row>
                <Column style={{ width: '38%', verticalAlign: 'middle' as const }}>
                  <Text style={policyPill}>
                    <span style={{ marginRight: 6 }}>{policyEmoji(side)}</span>
                    {policy.toUpperCase()}
                  </Text>
                </Column>
                <Column style={{ verticalAlign: 'middle' as const, textAlign: 'center' as const }}>
                  <Text style={itemCountText}>
                    ×{itemCount}{' '}
                    <span style={itemUnitText}>{itemUnit(side, itemCount)}</span>
                  </Text>
                </Column>
                <Column align="right" style={{ width: '28%', verticalAlign: 'middle' as const }}>
                  {source ? <Text style={sourcePill}>{String(source).toUpperCase()}</Text> : <Text style={{ margin: 0 }}> </Text>}
                </Column>
              </Row>
            </Section>

            {/* Premium */}
            <Section style={{ textAlign: 'center' as const, padding: '4px 0 24px' }}>
              <Text style={premiumAmount}>{fmtMoney(premium)}</Text>
              <Text style={premiumLabel}>PREMIUM</Text>
            </Section>

            {/* Achievement */}
            <Section style={achievementCard}>
              <Text style={achievementIcon}>🏆</Text>
              <Text style={achievementTitle}>
                {meRank === 1 ? '#1 TODAY' : meRank ? `#${meRank} TODAY` : 'ON THE BOARD'}
              </Text>
              <Text style={achievementSub}>
                {meRank === 1 ? 'Way to lead the team!' : meRank ? 'Keep climbing.' : 'Welcome to the board.'}
              </Text>
            </Section>

            {/* Team Goal */}
            <Section style={blockCard}>
              <Row>
                <Column>
                  <Text style={blockLabel}>DAILY TEAM GOAL</Text>
                </Column>
                <Column align="right">
                  <Text style={blockPct}>{goalPct}%</Text>
                </Column>
              </Row>
              <Text style={goalAmounts}>
                <span style={{ color: '#3DFF63' }}>{fmtMoney(totalPremium)}</span>
                <span style={{ color: '#9CA3AF' }}> / {fmtMoney(goal)}</span>
              </Text>
              <div style={progressTrack}>
                <div style={{ ...progressFill, width: `${goalPct}%` }} />
              </div>
            </Section>

            {/* Leaderboard */}
            <Section style={blockCard}>
              <Text style={blockLabel}>LEADERBOARD</Text>
              {top3.length === 0 ? (
                <Text style={emptyText}>No sales recorded yet today.</Text>
              ) : (
                top3.map((row, i) => {
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
                  const isYou = firstName(row.agent_name) === agentFirst
                  return (
                    <Row key={`${row.agent_name}-${i}`} style={{ ...lbRow, ...(isYou ? lbRowYou : {}) }}>
                      <Column style={{ width: '36px', fontSize: '20px', verticalAlign: 'middle' as const }}>
                        {medal}
                      </Column>
                      <Column style={{ color: '#FFFFFF', fontSize: '15px', fontWeight: 600, verticalAlign: 'middle' as const }}>
                        {row.agent_name}
                      </Column>
                      <Column align="right" style={{ color: '#3DFF63', fontSize: '15px', fontWeight: 700, verticalAlign: 'middle' as const }}>
                        {fmtMoney(row.premium)}
                      </Column>
                    </Row>
                  )
                })
              )}
            </Section>

            {/* Beat yesterday */}
            {yesterday != null && !aheadOfYesterday && (
              <Section style={challengeCard}>
                <Text style={challengeIcon}>📈</Text>
                <Text style={challengeTitle}>LET'S BEAT YESTERDAY!</Text>
                <Text style={challengeSub}>We need</Text>
                <Text style={challengeAmount}>{fmtMoney(needToBeat)}</Text>
                <Text style={challengeSub}>to beat yesterday's total.</Text>
              </Section>
            )}
            {yesterday != null && aheadOfYesterday && (
              <Section style={challengeCard}>
                <Text style={challengeIcon}>🚀</Text>
                <Text style={challengeTitle}>AHEAD OF YESTERDAY</Text>
                <Text style={challengeSub}>Keep the streak going.</Text>
              </Section>
            )}

            {/* Footer */}
            <div style={divider} />
            <Section style={{ padding: '4px 0 0' }}>
              <Row>
                <Column>
                  <Text style={footerBrand}>◆ {SITE_NAME}</Text>
                  <Text style={footerTag}>Anchor more policies. Win as a team.</Text>
                </Column>
                <Column align="right">
                  <Text style={footerMeta}>🎯 Focus Forward</Text>
                  <Text style={footerMeta}>👥 Team First</Text>
                </Column>
              </Row>
              <Text style={footerNote}>
                Automated internal alert from {SITE_NAME}{dateLabel ? ` · ${dateLabel}` : ''}.
                Total sales today: {totalSales}.
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SaleLeaderboardEmail,
  subject: (data: Record<string, any>) => {
    return `🔥 ${firstName(data.agentName)} closed one — ${policyLabel(data.side)}`
  },
  displayName: 'Sales alert',
  previewData: {
    agentName: 'Mia Villegas',
    leadName: 'James Parker',
    premium: 44492,
    side: 'auto',
    vehicles: 1,
    source: 'Aged Lead',
    totalSales: 9,
    totalPremium: 124882,
    teamGoalPremium: 250000,
    yesterdayPremium: 192331,
    dateLabel: 'Today',
    leaderboard: [
      { agent_name: 'Mia Villegas', sales: 3, premium: 44492 },
      { agent_name: 'Brandon Lee', sales: 2, premium: 22110 },
      { agent_name: 'Christian Davis', sales: 2, premium: 18442 },
    ],
  },
} satisfies TemplateEntry

/* Styles */
const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '16px', maxWidth: '560px', margin: '0 auto' }
const darkCard = {
  background: 'linear-gradient(180deg, #06120A 0%, #081A0D 50%, #0B2212 100%)',
  borderRadius: '18px',
  padding: '24px 22px',
  border: '1px solid rgba(61,255,99,0.20)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
}
const headerRow = { padding: '0 0 14px' }
const brandText = { color: '#FFFFFF', fontSize: '16px', fontWeight: 700, margin: 0, letterSpacing: '0.02em' }
const brandLock = { color: '#3DFF63', marginRight: '6px' }
const brandPill = {
  display: 'inline-block',
  color: '#3DFF63',
  fontSize: '11px',
  fontWeight: 700,
  background: 'rgba(61,255,99,0.10)',
  border: '1px solid rgba(61,255,99,0.30)',
  borderRadius: '999px',
  padding: '6px 12px',
  margin: 0,
  letterSpacing: '0.08em',
}
const divider = {
  height: '1px',
  background: 'linear-gradient(90deg, transparent, rgba(61,255,99,0.35), transparent)',
  margin: '0 0 18px',
}
const heroSection = { textAlign: 'center' as const, padding: '8px 0 4px' }
const h1 = {
  fontSize: '24px',
  fontWeight: 800 as const,
  color: '#FFFFFF',
  margin: '18px 0 4px',
  textAlign: 'center' as const,
  letterSpacing: '0.02em',
}
const subhead = {
  fontSize: '12px',
  color: '#3DFF63',
  fontWeight: 700,
  margin: 0,
  textAlign: 'center' as const,
  letterSpacing: '0.18em',
}
void subhead
const badgeBar = {
  background: 'rgba(61,255,99,0.05)',
  border: '1px solid rgba(61,255,99,0.25)',
  borderRadius: '14px',
  padding: '12px 14px',
  margin: '14px 0 10px',
}
const policyPill = {
  display: 'inline-block',
  color: '#3DFF63',
  fontSize: '14px',
  fontWeight: 800 as const,
  background: 'rgba(61,255,99,0.10)',
  border: '1px solid rgba(61,255,99,0.45)',
  borderRadius: '999px',
  padding: '6px 12px',
  margin: 0,
  letterSpacing: '0.10em',
}
const itemCountText = {
  color: '#FFFFFF',
  fontSize: '20px',
  fontWeight: 800 as const,
  margin: 0,
  textAlign: 'center' as const,
  letterSpacing: '0.06em',
}
const itemUnitText = {
  color: '#D1D5DB',
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.12em',
}
const sourcePill = {
  display: 'inline-block',
  color: '#9CA3AF',
  fontSize: '10px',
  fontWeight: 700,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '999px',
  padding: '4px 10px',
  margin: 0,
  letterSpacing: '0.10em',
}
const premiumAmount = {
  color: '#3DFF63',
  fontSize: '56px',
  fontWeight: 800 as const,
  margin: '8px 0 2px',
  textAlign: 'center' as const,
  letterSpacing: '-0.02em',
  textShadow: '0 0 24px rgba(61,255,99,0.45)',
  lineHeight: 1.05,
}
const premiumLabel = {
  color: '#9CA3AF',
  fontSize: '11px',
  fontWeight: 700,
  margin: 0,
  textAlign: 'center' as const,
  letterSpacing: '0.24em',
}
const achievementCard = {
  background: 'rgba(61,255,99,0.06)',
  border: '1px solid rgba(61,255,99,0.25)',
  borderRadius: '14px',
  padding: '18px 16px',
  margin: '0 0 16px',
  textAlign: 'center' as const,
  boxShadow: '0 0 24px rgba(61,255,99,0.10)',
}
const achievementIcon = { fontSize: '28px', margin: 0, textAlign: 'center' as const }
const achievementTitle = {
  color: '#3DFF63', fontSize: '20px', fontWeight: 800 as const,
  margin: '6px 0 2px', textAlign: 'center' as const, letterSpacing: '0.06em',
}
const achievementSub = { color: '#D1D5DB', fontSize: '13px', margin: 0, textAlign: 'center' as const }
const blockCard = {
  background: 'rgba(255,255,255,0.02)',
  border: '1px solid rgba(61,255,99,0.18)',
  borderRadius: '14px',
  padding: '16px 18px',
  margin: '0 0 14px',
}
const blockLabel = { color: '#9CA3AF', fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', margin: 0 }
const blockPct = { color: '#3DFF63', fontSize: '14px', fontWeight: 700, margin: 0 }
const goalAmounts = { fontSize: '18px', fontWeight: 700, margin: '8px 0 10px' }
const progressTrack = {
  height: '10px',
  width: '100%',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: '999px',
  overflow: 'hidden' as const,
  border: '1px solid rgba(61,255,99,0.15)',
}
const progressFill = {
  height: '100%',
  background: 'linear-gradient(90deg, #28C840, #3DFF63)',
  borderRadius: '999px',
  boxShadow: '0 0 14px rgba(61,255,99,0.55)',
}
const lbRow = {
  padding: '10px 0',
  borderTop: '1px solid rgba(61,255,99,0.08)',
}
const lbRowYou = { background: 'rgba(61,255,99,0.08)' }
const emptyText = { color: '#9CA3AF', fontSize: '13px', margin: '10px 0 0' }
const challengeCard = {
  background: 'linear-gradient(180deg, rgba(61,255,99,0.10), rgba(40,200,64,0.04))',
  border: '1px solid rgba(61,255,99,0.30)',
  borderRadius: '16px',
  padding: '20px 16px',
  margin: '4px 0 18px',
  textAlign: 'center' as const,
  boxShadow: '0 0 28px rgba(61,255,99,0.15)',
}
const challengeIcon = { fontSize: '28px', margin: 0, textAlign: 'center' as const }
const challengeTitle = {
  color: '#FFFFFF', fontSize: '16px', fontWeight: 800 as const,
  margin: '6px 0 8px', textAlign: 'center' as const, letterSpacing: '0.08em',
}
const challengeSub = { color: '#D1D5DB', fontSize: '13px', margin: 0, textAlign: 'center' as const }
const challengeAmount = {
  color: '#3DFF63', fontSize: '36px', fontWeight: 800 as const,
  margin: '4px 0', textAlign: 'center' as const,
  textShadow: '0 0 20px rgba(61,255,99,0.45)',
}
const footerBrand = { color: '#FFFFFF', fontSize: '14px', fontWeight: 700, margin: 0 }
const footerTag = { color: '#9CA3AF', fontSize: '12px', margin: '4px 0 0' }
const footerMeta = { color: '#D1D5DB', fontSize: '11px', margin: '2px 0', letterSpacing: '0.02em' }
const footerNote = { color: '#6B7280', fontSize: '10px', margin: '12px 0 0', textAlign: 'center' as const }
