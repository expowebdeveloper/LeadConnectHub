import type { ComponentType } from 'react'
import { template as accessRequestAlert } from './access-request-alert'
import { template as saleLeaderboard } from './sale-leaderboard'
import { template as emailHealthAlert } from './email-health-alert'
import { template as vendorIntegrationGuide } from './vendor-integration-guide'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 *
 * Example:
 *   import { template as welcomeTemplate } from './welcome'
 *   // then add to TEMPLATES: 'welcome': welcomeTemplate
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'access-request-alert': accessRequestAlert,
  'sale-leaderboard': saleLeaderboard,
  'email-health-alert': emailHealthAlert,
  'vendor-integration-guide': vendorIntegrationGuide,
}
