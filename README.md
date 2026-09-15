# Health for Wealth — Home Stock OS

A mobile-first household inventory system for refrigerator, freezer, pantry and kitchen/home organizers.

## Product thesis

The goal is not to manually count groceries forever. The system should answer four questions quickly:

1. **What do I have?**
2. **What is about to expire?**
3. **What am I running out of?**
4. **What should I buy next?**

This turns household stock into a simple loop:

`capture → inventory → consume → predict → replenish → learn`

## MVP screens

- **Home** — stock health, expiring soon, low-stock items, quick actions.
- **My Home** — Refrigerator / Freezer / Pantry / Organizers as visual zones.
- **Inventory** — search/filter items by location, category and status.
- **Item** — quantity, unit, minimum stock, expiry, opened date, location.
- **Shopping List** — automatically suggested replenishment plus manual items.
- **Activity** — purchases, consumption, waste and adjustments.

## Fast interaction design

The primary interaction should take seconds. Each item card exposes `− 1`, `+ 1`, `Used`, and `Add to list`. Later versions can add barcode scanning, receipt/photo capture, OCR/vision-assisted recognition and voice input.

## Stock states

- `OK`: quantity is above minimum.
- `LOW`: quantity is at/below minimum.
- `OUT`: zero stock.
- `EXPIRING`: expiration is near.
- `EXPIRED`: expiration passed.

## Data model

See `docs/data-model.md`. The model separates products from physical stock lots so that two cartons of milk purchased on different days can have different expiry dates.

## Roadmap

### V0 — beautiful manual inventory
Zones, products, stock lots, expiry, minimum stock and shopping list.

### V1 — continuity engine
Consumption history, days-of-cover, suggested reorder quantity and household routines.

### V2 — assisted capture
Barcode, receipt/photo and voice-assisted stock updates.

### V3 — Home Stock Intelligence
Forecast depletion, identify waste, suggest meals from expiring ingredients, learn preferred brands/package sizes and estimate household food spend.

## Design direction

Warm, calm and visual rather than spreadsheet-like: large location cards, food photography/icons, status chips, generous spacing, bottom navigation and one-tap quantity changes. The refrigerator/freezer/pantry metaphor should remain visible throughout the experience.
