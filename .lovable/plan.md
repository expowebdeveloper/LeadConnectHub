## Goal

Remove the hard rule that forces vendor uploads to include Auto. Any single lead upload can be Auto, Home, or Both — uploader's choice.

## Changes (src/routes/leads.new.tsx)

1. **Drop the vendor "Auto required" guard** in `handleSubmit`:
   - Remove the block that errors out when `vendorOnly && !hasType("auto")`.
   - Keep the "at least one lead type" check.

2. **Show the Home toggle for everyone** in the Coverage type selector:
   - Remove the `!vendorOnly` gate around the standalone "Home" `SegButton`.
   - Relabel the "Auto + Home (bundle)" button to "Both" uniformly (the bundle copy was vendor-flavored).

3. **Remove the vendor-only helper text** under the Coverage type label ("Every submitted lead must include Auto…").

4. **Leave all detail validation alone**:
   - Auto details (carrier + vehicles) still required only when Auto is selected.
   - Home housing status still required only when Home is selected.
   - Nothing else changes.

## Out of scope

- Vendor post API endpoint (`/api/public/leads/post/:token`) — backend ingest rules are unchanged.
- Shark Tank "Add lead" flow — same form, inherits the relaxation automatically.
- Anchorline / `list_leads` schema — no DB changes.

## Verification

- As a vendor user, submit a Home-only lead → succeeds, no "Auto required" toast.
- Auto-only and Both flows still work and still enforce their own field requirements.
- Coverage type row shows three buttons (Auto / Home / Both) for every role.
