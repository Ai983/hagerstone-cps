# CPS Projects

Canonical companion to the `cps.cps_projects` table — the **single source** every project dropdown/filter in the app reads. The PR wizard has no free-text project entry; procurement must register a project here first. Set `active = false` to hide a project from dropdowns without losing history.

> Generated from the live `cps_projects` table on **2026-06-03**. This is a human-readable snapshot — the table is authoritative. Regenerate after adding/editing projects.

## Schema
`id` (uuid) · `name` · `code` · `site_address` · `site_incharge_name` · `site_contact` · `active` · `created_at`

## Active projects (15)

| Project | Site address | Address quality |
|---|---|---|
| Auma India Pvt. Ltd | Plot No 38, A & 39-B, Peenya II Phase, Peenya, Bengaluru, Karnataka - 560058 | ✅ Good |
| Bansal Towers Gurugram | Bansal Towers, Gurugram, Haryana | ⚠️ Weak — no street/pincode |
| Dee Development Engineers LTD - Admin | Rev. Survey no. 567/1 P-2, 568/1, 577 Paki-1, 578, 579 Paki-2 of R.S. no. 28/P1, Village Lakhapas, Taluka Anjar, Kutch, Gujarat - 370110 | ✅ Good (shares address with Canteen) |
| Dee Development Engineers LTD - Canteen | Rev. Survey no. 567/1 P-2, 568/1, 577 Paki-1, 578, 579 Paki-2 of R.S. no. 28/P1, Village Lakhapas, Taluka Anjar, Kutch, Gujarat - 370110 | ✅ Good (same site as Admin) |
| Dee Foundation | Omaxe iStreet, SCO-223, nearby 2nd floor, sector 79, Faridabad, Haryana 121101 | ✅ Good |
| Hero Home's MU - Greater Noida | The Hemisphere, Gate Number 05, Near Wipro Circle, Gr. Noida, Uttar Pradesh 201310 | ✅ Good |
| Hero Homes Realty | Hero Homes - Ludhiana, Village Birmi, Sidhwan Canal Road, near Genpark Estate, Ludhiana, Punjab - 142027 | ✅ Good |
| Koko Town | Sec-17, Chandigarh 160017 | ⚠️ Weak — minimal |
| Max Hospital | Max Smart Super Speciality Hospital, Mandir Marg, Press Enclave Road, Saket, New Delhi - 110017 | ✅ Good |
| Minebeamitsumi | Peenya Industrial Area, Bengaluru - C/O Minebeamitsumi | ⚠️ Weak — no pincode/plot |
| MULTI-SITE | Consolidated - Bhuj (Dee Piping System) + Faridabad OMAXE Sports City | ℹ️ Meta-project (consolidated, not a single address) |
| Test Project | Test Project - Testing | ❌ Test data — should be `active = false` |
| Vaneet Infra | 5, National Highway, Gubmota Complex, Guru Gobind Singh Nagar, Dhakoli, Zirakpur, Punjab - 160104 | ✅ Good |
| Vinfast Jaipur | Girdhar colony, Plot no 8, Sikar Rd, opp. Manipal Hospital, SONI KA BAG, Murlipura, Jaipur, Rajasthan 302039 | ✅ Good |
| VST CORE-B | VST CORE-B | ❌ Placeholder — address = project name |

## Data-quality gaps (whole table)
- **`code` is NULL for all 15** — no short project codes assigned yet.
- **`site_incharge_name` and `site_contact` are NULL for all 15** — site-contact data not captured. PR delivery uses the locked `site_address`, so this is a gap for follow-ups/coordination, not a blocker.
- **`Test Project`** should be deactivated (`active = false`) so it stops appearing in dropdowns.
- **Weak addresses** (`Bansal Towers Gurugram`, `Koko Town`, `Minebeamitsumi`, `VST CORE-B`) need full street + pincode before they're reliable as locked PR delivery addresses.
