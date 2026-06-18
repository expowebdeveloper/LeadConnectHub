import { describe, expect, it } from "vitest";
import {
  buildLeadSaleRows,
  type LeadSaleInput,
} from "@/lib/sale-rows";
import { computeAutoSaleMetrics } from "@/lib/sale-metrics";

/**
 * These tests pin the contract that powers BOTH the leaderboard / dashboard
 * totals (analytics.functions buildSaleRows) and the per-agent details panel
 * (admin.functions buildAgentSaleRows). Both call buildLeadSaleRows, so any
 * scenario tested here is guaranteed to match across the two views.
 */

const A = "agent-a";
const B = "agent-b";

function totalsForAgent(rows: ReturnType<typeof buildLeadSaleRows>, agentId: string) {
  const mine = rows.filter((r) => r.ownerId === agentId);
  return {
    items: mine.reduce((s, r) => s + r.items, 0),
    premium: mine.reduce((s, r) => s + r.premium, 0),
    count: mine.length,
  };
}

function dashboardTotals(leads: LeadSaleInput[], agentId: string) {
  // Mirrors analytics.buildSaleRows: flatten every lead, then filter by owner.
  const rows = leads.flatMap((l) => buildLeadSaleRows(l));
  return totalsForAgent(rows, agentId);
}

function detailsTotals(leads: LeadSaleInput[], agentId: string) {
  // Mirrors admin.buildAgentSaleRows: per-lead build then filter by owner.
  const rows = leads.flatMap((l) =>
    buildLeadSaleRows(l).filter((r) => r.ownerId === agentId),
  );
  return totalsForAgent(rows, agentId);
}

describe("computeAutoSaleMetrics", () => {
  it("uses num_vehicles for items and adds motor-club to premium", () => {
    expect(
      computeAutoSaleMetrics({
        num_vehicles: 5,
        quoted_premium: 1000,
        auto_motor_club_premium: 73,
      }),
    ).toEqual({ items: 5, premium: 1073 });
  });

  it("falls back to auto_policies_count when num_vehicles is null", () => {
    expect(
      computeAutoSaleMetrics({
        num_vehicles: null,
        auto_policies_count: 3,
        quoted_premium: 500,
      }),
    ).toEqual({ items: 3, premium: 500 });
  });

  it("defaults items to 1 and premium to 0 when fields are missing", () => {
    expect(computeAutoSaleMetrics({})).toEqual({ items: 1, premium: 0 });
  });

  it("never returns items < 1, even when num_vehicles is 0 or negative", () => {
    expect(computeAutoSaleMetrics({ num_vehicles: 0 }).items).toBe(1);
    expect(computeAutoSaleMetrics({ num_vehicles: -2 }).items).toBe(1);
  });

  it("motor-club add-on adds to premium but not to item count", () => {
    const m = computeAutoSaleMetrics({
      num_vehicles: 2,
      quoted_premium: 800,
      auto_motor_club_premium: 73,
    });
    expect(m.items).toBe(2);
    expect(m.premium).toBe(873);
  });
});

describe("buildLeadSaleRows — single side scenarios", () => {
  it("emits no row when dispo is not sold", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      dispo: "quoted",
      claimed_by: A,
      num_vehicles: 3,
      quoted_premium: 999,
    });
    expect(rows).toEqual([]);
  });

  it("emits no row when sold but unclaimed", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      dispo: "sold",
      claimed_by: null,
      num_vehicles: 3,
      quoted_premium: 999,
    });
    expect(rows).toEqual([]);
  });

  it("auto sold: items = num_vehicles, premium = quoted + motor-club", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      dispo: "SOLD", // case-insensitive
      claimed_by: A,
      num_vehicles: 5,
      quoted_premium: 4997.1,
      auto_motor_club_premium: 73,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        side: "auto",
        ownerId: A,
        items: 5,
        premium: 5070.1,
      }),
    ]);
  });

  it("home sold: items = home_policies_count, premium = home_quoted_premium", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      home_dispo: "sold",
      home_claimed_by: A,
      home_policies_count: 1,
      home_quoted_premium: 55,
    });
    expect(rows).toEqual([
      expect.objectContaining({ side: "home", items: 1, premium: 55 }),
    ]);
  });

  it("lead_lines: defaults type to motorcycle and respects items/premium", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      lead_lines: [
        { dispo: "sold", claimed_by: A, items: 2, quoted_premium: 663.92 },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        side: "motorcycle",
        items: 2,
        premium: 663.92,
      }),
    ]);
  });

  it("lead_lines: explicit type (boat) is preserved", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      lead_lines: [
        { dispo: "sold", claimed_by: A, type: "boat", items: 1, quoted_premium: 400 },
      ],
    });
    expect(rows[0].side).toBe("boat");
  });
});

describe("buildLeadSaleRows — multi-side / multi-agent", () => {
  it("attributes auto and home to their own claimers independently", () => {
    const lead: LeadSaleInput = {
      id: "1",
      dispo: "sold",
      claimed_by: A,
      num_vehicles: 4,
      quoted_premium: 897.81,
      auto_motor_club_premium: 73,
      home_dispo: "sold",
      home_claimed_by: B,
      home_policies_count: 1,
      home_quoted_premium: 55,
    };
    const rows = buildLeadSaleRows(lead);
    expect(totalsForAgent(rows, A)).toEqual({ items: 4, premium: 970.81, count: 1 });
    expect(totalsForAgent(rows, B)).toEqual({ items: 1, premium: 55, count: 1 });
  });

  it("ignores lead_lines that aren't sold", () => {
    const rows = buildLeadSaleRows({
      id: "1",
      lead_lines: [
        { dispo: "quoted", claimed_by: A, items: 5, quoted_premium: 999 },
        { dispo: "sold", claimed_by: A, items: 1, quoted_premium: 200 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].premium).toBe(200);
  });
});

describe("dashboard vs details parity", () => {
  // Mia's real-world scenario from the bug report:
  //  - 5-car auto sale @ $4997.10 + $73 motor-club
  //  - 4-car auto sale @ $897.81 + $73 motor-club
  //  - 1-car auto sale @ $1152.96 (no motor-club)
  //  - 1 home policy @ $55
  //  - 1 motorcycle line, 1 unit @ $663.92
  // Expected agent totals: 12 items, $7,912.79 premium (incl. $146 motor-club)
  const miaLeads: LeadSaleInput[] = [
    {
      id: "mia-1",
      dispo: "sold",
      claimed_by: A,
      num_vehicles: 5,
      quoted_premium: 4997.1,
      auto_motor_club_premium: 73,
    },
    {
      id: "mia-2",
      dispo: "sold",
      claimed_by: A,
      num_vehicles: 4,
      quoted_premium: 897.81,
      auto_motor_club_premium: 73,
    },
    {
      id: "mia-3",
      dispo: "sold",
      claimed_by: A,
      num_vehicles: 1,
      quoted_premium: 1152.96,
    },
    {
      id: "mia-4",
      home_dispo: "sold",
      home_claimed_by: A,
      home_policies_count: 1,
      home_quoted_premium: 55,
    },
    {
      id: "mia-5",
      lead_lines: [
        { dispo: "sold", claimed_by: A, items: 1, quoted_premium: 663.92 },
      ],
    },
  ];

  it("matches expected agent totals", () => {
    expect(dashboardTotals(miaLeads, A)).toEqual({
      items: 12,
      premium: 7912.79,
      count: 5,
    });
  });

  it("dashboard totals equal details totals for every scenario", () => {
    const scenarios: Array<{ name: string; leads: LeadSaleInput[]; agent: string }> = [
      { name: "mia full book", leads: miaLeads, agent: A },
      {
        name: "auto only, no motor-club",
        leads: [
          {
            id: "x1",
            dispo: "sold",
            claimed_by: A,
            num_vehicles: 2,
            quoted_premium: 1200,
          },
        ],
        agent: A,
      },
      {
        name: "auto + motor-club",
        leads: [
          {
            id: "x2",
            dispo: "sold",
            claimed_by: A,
            num_vehicles: 3,
            quoted_premium: 1500,
            auto_motor_club_premium: 73,
          },
        ],
        agent: A,
      },
      {
        name: "auto falls back to auto_policies_count when num_vehicles missing",
        leads: [
          {
            id: "x3",
            dispo: "sold",
            claimed_by: A,
            num_vehicles: null,
            auto_policies_count: 4,
            quoted_premium: 2000,
          },
        ],
        agent: A,
      },
      {
        name: "home + motorcycle line shared on one lead",
        leads: [
          {
            id: "x4",
            home_dispo: "sold",
            home_claimed_by: A,
            home_policies_count: 2,
            home_quoted_premium: 110,
            lead_lines: [
              { dispo: "sold", claimed_by: A, items: 1, quoted_premium: 500 },
            ],
          },
        ],
        agent: A,
      },
      {
        name: "auto and home claimed by different agents (filter to A)",
        leads: [
          {
            id: "x5",
            dispo: "sold",
            claimed_by: A,
            num_vehicles: 1,
            quoted_premium: 800,
            auto_motor_club_premium: 73,
            home_dispo: "sold",
            home_claimed_by: B,
            home_policies_count: 1,
            home_quoted_premium: 200,
          },
        ],
        agent: A,
      },
      {
        name: "non-sold dispos contribute nothing",
        leads: [
          {
            id: "x6",
            dispo: "quoted",
            claimed_by: A,
            num_vehicles: 9,
            quoted_premium: 9999,
            auto_motor_club_premium: 999,
          },
        ],
        agent: A,
      },
      {
        name: "zero / negative num_vehicles still counts as 1 item",
        leads: [
          {
            id: "x7",
            dispo: "sold",
            claimed_by: A,
            num_vehicles: 0,
            quoted_premium: 600,
          },
        ],
        agent: A,
      },
    ];

    for (const s of scenarios) {
      const dash = dashboardTotals(s.leads, s.agent);
      const det = detailsTotals(s.leads, s.agent);
      expect(det, `details vs dashboard mismatch in scenario: ${s.name}`).toEqual(dash);
    }
  });

  it("filter-by-agent on details side never changes the other agent's totals", () => {
    const lead: LeadSaleInput = {
      id: "shared",
      dispo: "sold",
      claimed_by: A,
      num_vehicles: 2,
      quoted_premium: 1000,
      auto_motor_club_premium: 73,
      home_dispo: "sold",
      home_claimed_by: B,
      home_policies_count: 1,
      home_quoted_premium: 250,
      lead_lines: [
        { dispo: "sold", claimed_by: B, items: 1, quoted_premium: 400, type: "boat" },
      ],
    };
    expect(detailsTotals([lead], A)).toEqual({ items: 2, premium: 1073, count: 1 });
    expect(detailsTotals([lead], B)).toEqual({ items: 2, premium: 650, count: 2 });
    // And the unfiltered dashboard sees the union of both.
    expect(dashboardTotals([lead], A)).toEqual(detailsTotals([lead], A));
    expect(dashboardTotals([lead], B)).toEqual(detailsTotals([lead], B));
  });
});