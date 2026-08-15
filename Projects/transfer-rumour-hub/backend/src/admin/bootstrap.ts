import type { BootstrapDb } from './db.js'

// Resolves the chicken-and-egg problem created by retiring ADMIN_TOKEN:
// requireAdmin means nothing can grant the first admin without already
// being one. BOOTSTRAP_ADMIN_EMAIL is read once at server startup — if set
// and a User with that email already exists, promotes it to ADMIN
// (idempotent — safe to leave the env var set permanently across
// restarts). Same "trusted operator config" trust level as DATABASE_URL/
// JWT_SECRET, not attacker-reachable input.
//
// Ordering constraint, stated because it's easy to get backwards: the user
// must already be registered before this runs. The real sequence is
// register -> set BOOTSTRAP_ADMIN_EMAIL -> restart the server -> log in.
// See docs/admin-operations.md.
export async function bootstrapAdminFromEnv(db: BootstrapDb): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  if (!email) return

  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true } })
  if (!user) {
    console.warn(
      `[admin-bootstrap] BOOTSTRAP_ADMIN_EMAIL is set to "${email}" but no such user exists yet. ` +
        'Register that account first, then restart the server.',
    )
    return
  }

  if (user.role !== 'ADMIN') {
    await db.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
    console.log(`[admin-bootstrap] Promoted ${email} to ADMIN.`)
  }
}
