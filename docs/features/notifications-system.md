# Notifications System

**Phase:** 2
**Status:** stub
**Owner agents:** firebase-engineer, react-ui-engineer, i18n-engineer
**Spec reference:** `docs/AMS_Plan_v3.md` §15

## Purpose & user value

Notifications close the loop on async events. Spec lists a matrix of **role × event → channel** combinations:

- **Channels**: in-app (a bell with unread count), email (via Firebase Trigger Email extension).
- **Events** (Phase 2 starting set): asset assigned to me, asset returned from me, license expiring soon, repair cost crossed threshold, employee terminated (admins notified), batch arrival logged.

Templates are multi-language Tier-2 strings stored in a `notification_templates` collection so Super Admin can edit copy without a deploy.

## In scope (high-level)

- `notification_templates/{templateKey}` with multi-language `subject`, `body`, channel set, recipient role-rules.
- `notifications/{notificationId}` per-recipient log (in-app feed source).
- A `mail/{mailId}` collection consumed by the **Firebase Trigger Email** extension.
- A `<NotificationBell />` in the header showing unread in-app messages.
- A `/notifications` page listing all in-app messages for the user.
- A trigger fan-out via Cloud Function watching the relevant collections (assignments, repairs, licenses) and creating `notifications` + `mail` rows.
- Per-user mute preferences (`users/{uid}.notificationPrefs`).

## Out of scope (this stub)

- SMS / Telegram / push notifications.
- Quiet hours / batched digests.
- Notification analytics ("delivery rate", "open rate").

## Acceptance criteria

- [ ] In-app bell shows unread count and dropdown of recent items.
- [ ] Email template configurable in `/settings/notifications` per event.
- [ ] Per-user mute-by-event preferences.
- [ ] Trigger Email extension installed and processing the `mail` collection.
- [ ] Audit row written for every notification dispatch.
- [ ] Locale-aware: emails are in the recipient's `preferredLocale`.

## Open questions

- Default opt-in / opt-out matrix per event-role.
- Throttling: same event firing many times in a row (e.g., bulk import creating 50 assignments) — coalesce into one digest email?
