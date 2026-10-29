import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import {
  AnalyticsConsent,
  AnalyticsRouteTracker,
} from "./components/analytics";
import {
  LegacyWorkspaceRedirect,
  ProtectedRoute,
  WorkspaceRouteGuard,
} from "./components/auth";
import { GlassAuthShell } from "./components/auth/GlassAuthShell";
import { ProtectedAppLayout } from "./components/layout/ProtectedAppLayout";
import { KeyboardShortcutsModal } from "./components/settings";
import { PageSkeleton, type PageSkeletonVariant } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { WorkspaceChooserPage } from "./pages/WorkspaceChooserPage";
const ForgotPasswordPage = lazy(() =>
  import("./pages/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import("./pages/VerifyEmailPage").then((m) => ({
    default: m.VerifyEmailPage,
  })),
);
const CompanySetupPage = lazy(() =>
  import("./pages/CompanySetupPage").then((m) => ({
    default: m.CompanySetupPage,
  })),
);
const OAuthConsentPage = lazy(() =>
  import("./pages/OAuthConsentPage").then((m) => ({
    default: m.OAuthConsentPage,
  })),
);
const ChatPage = lazy(() =>
  import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const BroadcastsPage = lazy(() =>
  import("./pages/BroadcastsPage").then((m) => ({ default: m.BroadcastsPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const StatusPage = lazy(() =>
  import("./pages/StatusPage").then((m) => ({ default: m.StatusPage })),
);
const AcceptInvitationPage = lazy(() =>
  import("./pages/AcceptInvitationPage").then((m) => ({
    default: m.AcceptInvitationPage,
  })),
);

function AuthFallback() {
  return (
    <GlassAuthShell>
      <div className="w-full max-w-[460px] rounded-3xl border border-white/60 dark:border-white/10 bg-white/70 dark:bg-[#111b21]/75 backdrop-blur-xl shadow-2xl p-16 flex flex-col items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#075e54]/20 border-t-[#25d366]" />
      </div>
    </GlassAuthShell>
  );
}

function LazyPage({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: PageSkeletonVariant;
}) {
  return (
    <Suspense
      fallback={
        variant === "auth" ? (
          <AuthFallback />
        ) : (
          <PageSkeleton variant={variant} />
        )
      }
    >
      {children}
    </Suspense>
  );
}

function App() {
  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={<LoginPage />}
        />
        <Route
          path="/register"
          element={<Navigate to="/login" replace />}
        />
        <Route
          path="/forgot-password"
          element={
            <LazyPage variant="auth">
              <ForgotPasswordPage />
            </LazyPage>
          }
        />
        <Route
          path="/reset-password"
          element={
            <LazyPage variant="auth">
              <ResetPasswordPage />
            </LazyPage>
          }
        />
        <Route
          path="/verify-email"
          element={
            <LazyPage variant="auth">
              <VerifyEmailPage />
            </LazyPage>
          }
        />

        <Route
          path="/company-setup"
          element={
            <ProtectedRoute workspaceMode="setup">
              <LazyPage variant="auth">
                <CompanySetupPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />
        <Route
          path="/oauth/consent"
          element={
            <ProtectedRoute workspaceMode="chooser">
              <LazyPage>
                <OAuthConsentPage />
              </LazyPage>
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspaces"
          element={
            <ProtectedRoute workspaceMode="chooser">
              <WorkspaceChooserPage />
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <WorkspaceRouteGuard />
            </ProtectedRoute>
          }
        >
          <Route path="/w/:workspaceId" element={<ProtectedAppLayout />}>
            <Route
              path="chat"
              element={
                <LazyPage variant="chat">
                  <ChatPage />
                </LazyPage>
              }
            />
            <Route
              path="chat/:contactId"
              element={
                <LazyPage variant="chat">
                  <ChatPage />
                </LazyPage>
              }
            />
            <Route
              path="status"
              element={
                <LazyPage>
                  <StatusPage />
                </LazyPage>
              }
            />
            <Route
              path="team"
              element={
                <ProtectedRoute
                  requiredAnyPermission={["can_manage_team", "can_invite"]}
                >
                  <LazyPage variant="team">
                    <TeamPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="settings/:section?"
              element={
                <LazyPage variant="settings">
                  <SettingsPage />
                </LazyPage>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute requiredPermission="can_view_audit">
                  <LazyPage>
                    <AuditPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute requiredPermission="can_view_dashboard">
                  <LazyPage variant="dashboard">
                    <DashboardPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="broadcasts"
              element={
                <ProtectedRoute requiredPermission="can_send_bulk_messages">
                  <LazyPage>
                    <BroadcastsPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="broadcasts/:jobId"
              element={
                <ProtectedRoute requiredPermission="can_send_bulk_messages">
                  <LazyPage>
                    <BroadcastsPage />
                  </LazyPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="notifications"
              element={
                <LazyPage>
                  <NotificationsPage />
                </LazyPage>
              }
            />
            <Route
              path="inbox-appearance"
              element={<Navigate to="settings/inbox-appearance" replace />}
            />
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="*" element={<Navigate to="chat" replace />} />
          </Route>
        </Route>

        {[
          "/chat",
          "/chat/:contactId",
          "/status",
          "/settings",
          "/settings/:section",
          "/dashboard",
          "/broadcasts",
          "/team",
          "/audit",
          "/notifications",
          "/inbox-appearance",
        ].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <ProtectedRoute>
                <LegacyWorkspaceRedirect />
              </ProtectedRoute>
            }
          />
        ))}

        <Route
          path="/invite/:token"
          element={
            <LazyPage>
              <AcceptInvitationPage />
            </LazyPage>
          }
        />
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
      <AnalyticsRouteTracker />
      <AnalyticsConsent />
      <KeyboardShortcutsModal />
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
