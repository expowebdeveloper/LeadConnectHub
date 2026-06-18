import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const QuerySchema = z.object({
  q: z.string().trim().min(4).max(120),
})

type NominatimResult = {
  display_name?: string
  address?: {
    house_number?: string
    road?: string
    city?: string
    town?: string
    village?: string
    hamlet?: string
    municipality?: string
    county?: string
    state?: string
    postcode?: string
    country_code?: string
  }
}

function normalizeQuery(query: string) {
  return /\bfl\b|\bflorida\b/i.test(query) ? query : `${query}, Florida, USA`
}

function normalizeCounty(county?: string) {
  return String(county ?? '').replace(/\s+County$/i, '').trim()
}

function toStreet(result: NominatimResult) {
  const street = [result.address?.house_number, result.address?.road].filter(Boolean).join(' ').trim()
  return street || String(result.display_name ?? '').split(',')[0]?.trim() || ''
}

export const Route = createFileRoute('/api/public/address-suggest')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const parsed = QuerySchema.safeParse({ q: url.searchParams.get('q') ?? '' })

        if (!parsed.success) {
          return Response.json({ error: 'Invalid query', suggestions: [] }, { status: 400 })
        }

        const upstream = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(normalizeQuery(parsed.data.q))}`,
          {
            headers: {
              'Accept-Language': 'en-US,en;q=0.9',
              'User-Agent': 'Lovable Address Lookup',
            },
          },
        )

        if (!upstream.ok) {
          return Response.json({ error: 'Lookup failed', suggestions: [] }, { status: 502 })
        }

        const results = (await upstream.json()) as NominatimResult[]
        const seen = new Set<string>()
        const suggestions = results
          .filter((item) => item.address?.country_code?.toLowerCase() === 'us')
          .filter((item) => /florida/i.test(String(item.address?.state ?? '')))
          .map((item) => {
            const street = toStreet(item)
            const city =
              item.address?.city ||
              item.address?.town ||
              item.address?.village ||
              item.address?.hamlet ||
              item.address?.municipality ||
              ''
            const zip = String(item.address?.postcode ?? '')
            const label = String(item.display_name ?? '').trim()
            const key = `${street}|${city}|${zip}`

            return {
              key,
              label,
              parts: {
                street,
                city,
                zip,
                county: normalizeCounty(item.address?.county),
                state: 'FL',
              },
            }
          })
          .filter((item) => {
            if (!item.label || !item.parts.street || seen.has(item.key)) return false
            seen.add(item.key)
            return true
          })
          .map(({ key, ...item }) => item)

        return Response.json(
          { suggestions },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})