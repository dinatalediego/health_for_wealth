# Product specification

## North-star experience

Open the app in the kitchen and understand the household in under 10 seconds.

### Home

Header: `Mi cocina` + household selector.

Hero card: **Stock saludable 82%** with four compact metrics:
- 47 products at home
- 5 low stock
- 3 expiring soon
- 2 on shopping list

Below:

**Where is it?**
- 🧊 Refrigeradora — 18 items
- ❄️ Freezer — 12 items
- 🥫 Despensa — 14 items
- 🧺 Organizadores — 3 items

**Needs attention**
Cards ordered by urgency: expired → expiring → out → low.

**Quick add**
Large floating `+` opens: Scan barcode / Take photo / Add manually / Speak.

Bottom navigation: `Inicio · Stock · Comprar · Actividad · Casa`.

## Location view

The user should feel like opening a digital fridge, not filtering a database. Show sub-zones such as door, upper shelf, lower shelf and vegetable drawer. Each product card shows image/icon, quantity, expiry/status and large `−` / `+` controls.

## Shopping list

Two sections:

**Suggested** — generated from minimum/target stock and later from expected depletion.

**Manual** — arbitrary household needs.

When an item is marked bought, offer a one-step flow to convert it into stock: quantity, location and optional expiry.

## Continuity engine

For each product maintain two user-friendly concepts:

- **Minimum:** point at which I do not want to run out.
- **Ideal:** quantity I normally want after shopping.

Example: eggs: on hand 4, minimum 6, ideal 18 → suggest buying 14.

Future prediction improves this with consumption velocity and purchase cadence.

## Expiry UX

Use FIFO by default. When consuming an item with multiple lots, suggest the lot expiring first. Surface `Consume primero` rather than requiring the user to reason about lot IDs.

## Home beyond food

The same architecture can later support cleaning products, toiletries, pet supplies, medicine cabinet metadata (without medical decision-making), paper goods and other household consumables. Keep locations and categories generic enough for this expansion.

## Success metrics

The product succeeds if it reduces:
- unexpected stock-outs,
- duplicate purchases,
- expired/wasted food,
- time spent checking what is at home.

Leading product metrics: weekly inventory updates, shopping-list conversion, percentage of active products with min/ideal stock configured, and percentage of purchases captured.
