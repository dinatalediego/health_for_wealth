# Consequence loop

Production behavior:

1. confirmed Photo Scan updates inventory
2. server recalculates conservative Home Meal Coverage Days
3. a material drop creates a consequence event
4. Resend sends an immediate email with Smart Restock + Scan deep links
5. Smart Restock records a purchase event
6. UI prompts a new scan for physical reconciliation
7. the next scan compares against the previous scan state
8. crossing back above the threshold closes the loop as coverage recovered

Immediate alert gates:

- any meal type reaches zero
- coverage crosses from above the household threshold to at/below it
- coverage falls by at least two days between scans
- stockouts increase
- recovery above the threshold after a low-coverage scan

Daily Vercel Cron remains a deduplicated safety net.
