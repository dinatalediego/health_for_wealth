# Health for Wealth — Kitchen Readiness

A mobile-first household food operating system. The product is not trying to answer only **“how many groceries do I have?”**. It is designed to answer:

> **How many days can I eat well at home with the food I have right now?**

## Vertical slices v0 + Photo Scan Beta

The current product closes the loop:

`update stock → meal capacity → consume → decrement → report → smart restock → replenish`

Visual loop:

`photo → on-device detection → human review → confirmed stock → meals → reporting`

### Screens

- **Inicio** — Home Meal Coverage Days, meal capacity, kitchen spaces and attention queue.
- **Stock** — refrigerator / freezer / pantry / organizers with fast quantity entry and min/ideal targets.
- **Meals** — breakfast, lunch, dinner and snacks that are actually possible from current stock.
- **Comprar** — replenishment to ideal stock, prioritized by meal capacity unlocked.
- **Photo Scan Beta** — camera/upload → free browser inference → review → confirmed inventory update.
- **Personal Kitchen** — custom foods, meals and storage spaces.
- **Digital Twin** — latest private photo and fill snapshot per storage space.
- **Reportes** — coverage, stock health, meals, stockouts, event history and Computer Vision review metrics.

The interface is deliberately refrigerator-like and mobile-first rather than spreadsheet-like.

## Persistence modes

### Supabase cloud mode
If the two public Supabase environment variables are configured, the app uses Supabase Auth + Postgres + RLS and syncs across devices.

### Local-first mode
Without cloud configuration the full loop still works in browser localStorage. This is intentional: infrastructure should never block validating the daily habit.

## Backend

The live migration uses tables prefixed with `hfw_` so the product can coexist safely inside a shared Supabase project. RLS is enabled and RPC stock/meal actions verify household membership.

Core entities:

- households / members
- locations
- products
- inventory lots
- inventory events
- meal templates / ingredients
- meal events
- notification preferences

## Email notifications

A daily Vercel Cron route is included at `/api/digest`. For reliable transactional delivery, **Resend** is the one additional SaaS recommended for v0.

Required server-side variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `CRON_SECRET`

The digest is action-oriented: it sends when coverage is below the configured threshold or stock needs attention.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Deploy

Designed for Vercel. Add the public Supabase URL/key for cloud sync. Add the four private variables above only when enabling email delivery.

## Product principle

Computer Vision now ships as a human-in-the-loop beta using TensorFlow.js + COCO-SSD in the browser. It never writes inventory without explicit confirmation. See `docs/vision-beta.md`.

See `docs/product-spec.md`, `docs/data-model.md` and `docs/architecture.md`.


## Closed consequence loop

The production loop now supports:

`scan → coverage evaluation → consequence email → Smart Restock purchase → new scan → recovery detection`

Immediate emails are consequence-based. They are sent when a confirmed scan causes a material state transition such as zero capacity for a meal type, crossing the configured coverage threshold, a drop of two or more coverage days, or new stockouts. A later scan that restores coverage above the threshold can close the loop with a recovery event.

The Reporting screen includes a manual **Enviar prueba** action so Resend delivery can be verified without waiting for the cron.

## Vision evidence stack

The scan pipeline follows a free-first escalation order:

1. COCO-SSD object detection in-browser
2. ZXing barcode decoding in-browser
3. Tesseract OCR in-browser
4. human review
5. optional multimodal fallback only for unresolved/low-confidence cases

The optional fallback is inactive unless `OPENAI_API_KEY` is configured. `OPENAI_VISION_MODEL` defaults to `gpt-5.6-luna`.

Product barcodes can be stored in **Personal Kitchen**. Scan evidence records its source as object / barcode / OCR / multimodal so future accuracy analysis can separate the contribution of each method.

## Temporal visual comparison

Digital Twin cards compare the latest fill estimate with the previous scan for the same storage space and show the change in percentage points. This is an observation signal, not a volumetric measurement.
