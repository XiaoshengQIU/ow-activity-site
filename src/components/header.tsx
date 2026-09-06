import { grantedPermissions, hasPermission } from "@/lib/admin-permissions";
import { getCurrentSession, shouldOpenAdminSetup } from "@/lib/auth";
import { SiteNav } from "@/components/site-nav";
import { AdminUpdateNotifier } from "@/components/admin-update-notifier";
import { hashToken } from "@/lib/oauth/security";

export async function Header({ children }: { children: React.ReactNode }) {
  const [session, openSetup] = await Promise.all([
    getCurrentSession(),
    shouldOpenAdminSetup(),
  ]);
  const user = session?.user;
  const isAdmin = user?.role === "ADMIN" && user.status === "APPROVED";
  return (
    <>
      <SiteNav
        loginHref={openSetup ? "/admin/setup" : "/login"}
        user={
          user
            ? {
                name: user.profile?.displayName ?? user.username,
                avatarUrl: user.profile?.avatarUrl,
                isAdmin: user.role === "ADMIN" && user.status === "APPROVED",
                permissions: grantedPermissions(user),
              }
            : null
        }
      >
        {children}
      </SiteNav>
      {isAdmin && session && hasPermission(user, "updates") ? (
        <AdminUpdateNotifier
          sessionKey={hashToken(`update-notice:${session.id}`)}
        />
      ) : null}
    </>
  );
}
