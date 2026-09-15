# Product specification — Kitchen Readiness

## North-star outcome

The app should make **eating at home the lowest-friction option**.

Primary metric:

### Home Meal Coverage Days

A conservative estimate of the number of full days the current inventory can cover **breakfast + lunch + dinner + snack**, accounting for shared ingredients rather than double-counting them across alternative meals.

## Core loop

`capture/update → inventory → meal capacity → consume → decrement → report → restock → replenish`

A vertical slice is complete only when the same user can move through the full loop without leaving the product.

## Home

The hero answers one question in seconds:

> **You have food for N days.**

Under it:

- breakfast capacity
- lunch capacity
- dinner capacity
- snack capacity
- stock health
- refrigerator / freezer / pantry / organizer readiness
- attention queue

## Stock

Every item exposes:

- current quantity
- unit
- minimum stock
- ideal stock
- storage space
- quick − / + controls
- direct numeric entry

Minimum = point where continuity is at risk.  
Ideal = normal post-shopping target.

## Meal engine

Four types: breakfast, lunch, dinner and snack.

A meal is available only when all non-optional ingredients can cover at least one serving. Pressing **Comí esto** consumes the ingredient quantities and creates event history.

This makes the product materially different from a grocery counter: inventory is translated into **meals and days**.

## Smart Restock

Suggested quantity:

`max(ideal stock - current stock, 0)`

Only items at/below minimum are promoted into the urgent list. The UI also estimates how much meal capacity a replenishment unlocks.

## Reporting

The reporting section is part of the product loop, not decoration.

Initial metrics:

- Home Meal Coverage Days
- stock health %
- breakfast/lunch/dinner/snack capacity
- meals logged in last 7 days
- current stockouts
- low-stock items
- inventory event history
- waste events when they start being captured

Future evidence-based metrics:

- average depletion velocity
- forecast stockout date
- purchase cadence
- cost per home meal
- estimated outside-food spend avoided
- waste rate
- nutrition coverage

Do not invent monetary savings until cost and behavior data exist.

## Notifications

Prefer consequence-based alerts over noisy item alerts.

Good:
> Breakfast coverage fell below 2 days. Buying 12 eggs and 6 bananas restores ~5 days.

Bad:
> You have 4 eggs.

Daily email digest should only send when coverage crosses the configured threshold or important stock attention exists.

## Vision roadmap

1. manual entry must be excellent first
2. photo upload
3. model proposes item + approximate quantity
4. user corrects/approves
5. corrections become labeled evidence
6. automate only after measured accuracy justifies it

Vision is an accelerator, not the source of truth in v0.
