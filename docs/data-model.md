# Data model — Home Stock OS

## Core entities

### households
- id
- name
- timezone
- created_at

### household_members
- household_id
- user_id
- role (`owner`, `member`)

### locations
Represents physical zones.
- id
- household_id
- name (`Refrigeradora`, `Freezer`, `Despensa`, `Organizador`)
- type (`fridge`, `freezer`, `pantry`, `organizer`, `other`)
- parent_location_id nullable
- sort_order

A location can contain child locations such as `Refrigeradora > Puerta`, `Refrigeradora > Cajón verduras`, or `Despensa > Cereales`.

### products
The reusable identity of an item.
- id
- household_id
- name
- category
- default_unit
- preferred_brand nullable
- barcode nullable
- image_url nullable
- min_stock nullable
- target_stock nullable
- active

### stock_lots
The physical stock currently at home. Lot-level tracking preserves expiry.
- id
- household_id
- product_id
- location_id
- quantity
- unit
- purchased_at nullable
- opened_at nullable
- expires_at nullable
- unit_cost nullable
- source (`manual`, `barcode`, `receipt`, `photo`, `voice`, `import`)
- created_at
- updated_at

### inventory_events
Append-only event history.
- id
- household_id
- product_id
- stock_lot_id nullable
- location_id nullable
- event_type (`purchase`, `consume`, `waste`, `adjust`, `move`, `open`)
- quantity_delta
- unit
- reason nullable
- occurred_at
- actor_user_id nullable

### shopping_list_items
- id
- household_id
- product_id nullable
- free_text nullable
- suggested_quantity nullable
- unit nullable
- reason (`low_stock`, `out_of_stock`, `planned`, `manual`)
- status (`needed`, `in_cart`, `bought`, `dismissed`)
- created_at
- completed_at nullable

## Derived metrics

Do not store these as manually maintained fields when they can be derived:

- `quantity_on_hand = SUM(stock_lots.quantity)`
- `days_to_expiry = expires_at - today`
- `avg_daily_consumption` from inventory events
- `days_of_cover = quantity_on_hand / avg_daily_consumption`
- `reorder_needed = quantity_on_hand <= min_stock`
- `suggested_reorder = MAX(target_stock - quantity_on_hand, 0)`
- `waste_rate = wasted / purchased`

## Important modeling decision

**Product ≠ stock lot.** A product is “Greek yogurt”; a lot is “2 Greek yogurts bought Sep 15, expiring Sep 25”. This distinction is required for reliable expiry management, FIFO suggestions, waste analysis and future forecasting.

## Future intelligence

Once event history exists, the system can estimate depletion dates, recommend reorder timing, detect abnormal waste, prioritize FIFO consumption and suggest recipes around ingredients likely to expire before being consumed.
