# Waylan private reply notifications

## Scope
- Public comments remain on GitHub Discussions (waylan-comments).
- This blog's Cloudflare D1 contains notification **metadata only** (no comment content, email addresses, OAuth tokens, or private GitHub notifications).
- Replies notify the intended GitHub author. New comments (including replies) notify the configured site admin unless authored by that admin.
- Self-replies never notify. GitHub redelivery is deduplicated by (recipient, comment ID, kind).
- Moderators can still use GitHub's native mail/inbox subscription.
- Inbox polling operates while the blog is open; this does NOT implement device push or email.

## Safe production activation
1. In GitHub Desktop, Fetch/Pull latest from main on the private `YohakuSama/waylan-blog` repository.
2. In the project root, run `npx.cmd wrangler d1 migrations apply echo-db --remote` to apply `0004_notifications.sql`. Confirm the migration completes.
3. Generate one cryptographically random 32-byte webhook secret. Do not commit or share it.
4. Open GitHub Settings → Developer settings → GitHub Apps → Waylan Comments Login. Activate Webhook and set URL `https://waylan.org/api/webhook/github`, Content type JSON, and the generated secret. In Permissions & events subscribe to `Discussion comment` and `Discussion` events. Leave Repository permissions = Discussions Read and write. Ensure installation remains only `waylan-comments`.
5. Cloudflare → Worker `waylan-blog` → Settings → **Runtime variables and secrets** → Production: add `GITHUB_WEBHOOK_SECRET` as **Secret** containing the same value.
6. Finally add `NOTIFICATIONS_ENABLED` as **Variable** with value `true`. Deploy.
7. Test: as a second GitHub user, reply to an existing comment or post a new comment. The recipient/admin must be logged into waylan.org to see the notification bell. Check mark-read and opt-out; check GitHub webhook recent deliveries for response 200.

## Rollback
Delete `NOTIFICATIONS_ENABLED` or set it to `false`, redeploy. The comment system is unaffected. The optional notification tables may remain in D1 without being read.

## Privacy and security
- Keep the webhook secret confidential; Cloudflare runtime Secret and GitHub App Webhook secret must match exactly.
- Do not grant extra GitHub notification scopes or access to private source repositories.
- The `/api/notifications` inbox requires the authenticated current GitHub session. Changing notification settings and marking read require the session CSRF token. Every SQL read/update is scoped to the authenticated GitHub login.
- GitHub webhook signatures and repository full name are checked. A claimed reply target is confirmed against the GitHub GraphQL API before notifying.
- Notifications expire automatically after 180 days.
- The feature is opt-in until database and webhook configuration are complete, preventing missing-table errors during automatic deployments.
