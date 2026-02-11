# Founder Interview — AgentReach-Flow V2

Use this in the morning to lock product scope before next rewrite.

## 1) Product Definition
1. What is the single job of AgentReach-Flow? (one sentence)
2. Who is the primary user daily: Bao, VA, or both?
3. What must happen in < 3 clicks on the homepage?

## 2) Newsletter Production System
4. Is the source of truth for content:
   - Postcards HTML,
   - in-app editor,
   - or both?
5. For v2, do we prioritize:
   - A) Better HTML import/preview/edit,
   - B) True block editor,
   - C) Approval workflow and comments?
6. What are the mandatory fields before a newsletter can move to client review?

## 3) Approval + Comment Loop
7. Should client feedback be accepted from:
   - review link comments,
   - Gmail replies,
   - both merged?
8. Should unresolved comments block status changes to `approved`/`sent`?
9. What is your ideal revision loop SLA (e.g., same day, 24h)?

## 4) Billing + Project Automation
10. Invoice paid => auto-create newsletter project always? (yes/no)
11. For unpaid but scheduled newsletters, what rule should apply?
12. Weekly vs biweekly plans: exactly how many projects should queue each month?

## 5) Sending + Deliverability
13. Is Postmark the final sender for all clients, or mixed with Mailchimp for now?
14. Should we enforce sender verification before allowing `send`?
15. What does a "send-ready" checklist include (design QA, links, compliance, approval)?

## 6) Team Workflow
16. Which views are mandatory:
   - board by status,
   - calendar by send date,
   - client timeline,
   - all three?
17. Which notifications matter most:
   - due today,
   - waiting on client,
   - blocked by missing assets,
   - payment mismatch?
18. Who owns each stage: content, QA, approval follow-up, send?

## 7) Definition of Done (Non-Negotiable)
19. What are your exact done criteria for a newsletter project?
20. What metrics matter weekly:
   - on-time send rate,
   - revision count per newsletter,
   - approval turnaround,
   - reply/conversion rate?

---

## Output after interview
- Freeze V2 scope in one spec
- Lock status machine
- Build only the critical path first:
  1. project creation
  2. editor/import
  3. approval/comments
  4. send via Postmark
