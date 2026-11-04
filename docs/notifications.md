# Waylan private reply notifications

## Scope
- Public comments remain on GitHub Discussions (waylan-comments).
- This blog's Cloudflare D1 contains notification **metadata only** (no comment content, email addresses, OAuth tokens, or private GitHub notifications).
- Replies notify the intended GitHub author. New comments (including replies) notify the configured site admin unless authored by that admin.
- Self-replies never notify. GitHub redelivery is deduplicated by (recipient, comment ID, kind).
- Moderators can still use GitHub's native mail/inbox subscription.
- Inbox refreshes when opened, when the tab becomes visible again, and during periodic checks while the blog is open; this does NOT implement device push or email.

## Safe production activation
1. In GitHub Desktop, Fetch/Pull latest from main on the private `YohakuSama/waylan-blog` repository.
2. In the project root, run `npx.cmd wrangler d1 migrations apply echo-db --remote` to apply `0004_notifications.sql`. Confirm the migration completes.
3. Generate one cryptographically random 32-byte webhook secret. Do not commit or share it.
4. Open GitHub Settings → Developer settings → GitHub Apps → Waylan Comments Login. Activate Webhook and set URL `https://waylan.org/api/webhook/github`, Content type JSON, and the generated secret. In Permissions & events subscribe to `Discussion comment` and `Discussion` events. Leave Repository permissions = Discussions Read and write. Ensure installation remains only `waylan-comments`.
5. Cloudflare → Worker `waylan-blog` → Settings → **Runtime variables and secrets** → Production: add `GITHUB_WEBHOOK_SECRET` as **Secret** containing the same value.
6. `NOTIFICATIONS_ENABLED=true` is now versioned in `wrangler.jsonc`, so subsequent Workers Builds cannot silently drop a dashboard-only flag. Deploy the latest `main`. The notification status will report **disabled** until the D1 tables, GitHub reader token and signed webhook secret are all available; this avoids advertising a broken inbox.
7. Test: as a second GitHub user, reply to an existing comment or post a new comment. The notification bell is always visible between the reading shelf and settings. Sign in to read private notifications; disabled services and network failures are shown inside the panel, with retry. Check mark-read and opt-out; check GitHub webhook recent deliveries for response 200.

## Rollback
Set `NOTIFICATIONS_ENABLED` to `false` in `wrangler.jsonc` and redeploy (do not rely on editing a dashboard-only variable that the next Wrangler deploy may overwrite). The comment system is unaffected. The optional notification tables may remain in D1 without being read.

## Privacy and security
- Keep the webhook secret confidential; Cloudflare runtime Secret and GitHub App Webhook secret must match exactly.
- Do not grant extra GitHub notification scopes or access to private source repositories.
- The `/api/notifications` inbox requires the authenticated current GitHub session. Changing notification settings and marking read require the session CSRF token. Every SQL read/update is scoped to the authenticated GitHub login.
- GitHub webhook signatures and repository full name are checked. A claimed reply target is confirmed against the GitHub GraphQL API before notifying.
- Notifications expire automatically after 180 days.
- Inbox visibility and unread count are restricted to post IDs in the **currently deployed public article manifest**, not merely historical D1 `posts` rows. Deleted/unpublished articles cannot generate new notification dead links. Historical notification metadata and GitHub Discussion mappings are not automatically deleted; republishing with the same stable post ID restores the association. Displayed article slug/title come from the deployed manifest so readers never see stale D1 URLs.
- The bell is a labeled non-modal dialog. Keyboard focus enters on open; Escape and the close button return focus to the bell. Browser QA checks focus behavior at mobile and tablet widths.
- The feature is opt-in until database and webhook configuration are complete, preventing missing-table errors during automatic deployments.


## Owner-only self-test
When NOTIFICATIONS_ENABLED=true, sign in as a login listed in ADMIN_GITHUB_LOGINS and open the notification bell. Two owner-only buttons appear:
- **发送测试通知** creates a D1-only test entry, addressed to your signed-in GitHub login. It does not call GitHub Discussions or trigger email and is rate-limited to four attempts per hour.
- **清空测试消息** deletes only your own synthetic test items. Real reply and comment notifications remain untouched.
Test messages link to an existing Waylan article, not to a non-existent GitHub comment.
Regular readers never see the controls, and the Worker independently rejects their requests.
