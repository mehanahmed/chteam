import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { GlassAuthShell } from "../components/auth/GlassAuthShell";
import { BrandLogo } from "../components/brand/BrandLogo";
import { Button } from "../components/ui/button";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { resendVerification } from "../lib/api";
import {
  buildAuthUrl,
  getAuthRedirectFromState,
  getInvitationTokenFromRedirect,
  getSafeAuthRedirect,
} from "../lib/auth-redirect";
import { isEmailVerificationRequiredError } from "../lib/email-verification";
import { productAnalytics } from "../lib/product-analytics";
import { type LoginFormData, loginSchema } from "../lib/schemas";
import { workspacePath } from "../lib/workspace-routes";

export function LoginPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo =
    getSafeAuthRedirect(searchParams.get("redirect")) ??
    getAuthRedirectFromState(location.state);
  const invitationToken = getInvitationTokenFromRedirect(redirectTo);
  const suggestedEmail = searchParams.get("email") ?? "";
  const { login, isLoading, error, clearError, isAuthenticated } = useAuth();
  const {
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    needsWorkspaceSetup,
    needsWorkspaceChoice,
  } = useWorkspace();

  const [verificationRequired, setVerificationRequired] = React.useState(false);
  const [isResending, setIsResending] = React.useState(false);
  const [resendMessage, setResendMessage] = React.useState<string | null>(null);
  const [resendError, setResendError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    getValues,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: suggestedEmail,
      password: "",
    },
  });
  const currentEmail = watch("email");

  // Return users to the invitation (or other protected destination) after
  // login. An invitation can be accepted before the user has any company.
  React.useEffect(() => {
    if (!isAuthenticated || isWorkspaceLoading) return;
    if (redirectTo) {
      navigate(redirectTo, { replace: true });
    } else if (needsWorkspaceSetup) {
      navigate("/company-setup", { replace: true });
    } else if (needsWorkspaceChoice || !activeWorkspaceId) {
      navigate("/workspaces", { replace: true });
    } else {
      navigate(workspacePath(activeWorkspaceId), { replace: true });
    }
  }, [
    activeWorkspaceId,
    isAuthenticated,
    isWorkspaceLoading,
    navigate,
    needsWorkspaceChoice,
    needsWorkspaceSetup,
    redirectTo,
  ]);

  const onSubmit = async (data: LoginFormData) => {
    clearError();
    setVerificationRequired(false);
    setResendMessage(null);
    setResendError(null);
    try {
      await login(data.email, data.password);
      productAnalytics.track("login", { method: "email" });
    } catch (loginError) {
      if (isEmailVerificationRequiredError(loginError)) {
        setVerificationRequired(true);
      }
    }
  };

  const resendVerificationEmail = async () => {
    const { email, password } = getValues();
    setIsResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const response = await resendVerification(
        email,
        password,
        invitationToken,
      );
      setResendMessage(response.message);
    } catch (resendFailure) {
      setResendError(
        resendFailure instanceof Error
          ? resendFailure.message
          : t(
              "auth.resendVerificationFailed",
              "Could not resend the verification email",
            ),
      );
    } finally {
      setIsResending(false);
    }
  };

  const clearLoginFeedback = () => {
    if (error) clearError();
    if (verificationRequired) setVerificationRequired(false);
    setResendMessage(null);
    setResendError(null);
  };

  return (
    <GlassAuthShell>
      {/* Centered Frosted Glass Card with WhatsApp Aesthetics */}
      <div className="w-full max-w-[420px] rounded-[2rem] bg-white/85 dark:bg-[#111b21]/90 backdrop-blur-2xl border border-white/90 dark:border-white/10 shadow-[0_24px_64px_-16px_rgba(7,94,84,0.18)] dark:shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)] p-7 sm:p-9 text-slate-800 dark:text-slate-100 relative transition-all duration-300">
        
        {/* OmniTeam Brand Logo */}
        <div className="mx-auto mb-6 flex justify-center">
          <BrandLogo className="h-14 sm:h-16 w-auto object-contain drop-shadow-sm transition-transform duration-200 hover:scale-[1.02]" />
        </div>

        {/* Title & Omnichannel Business Subtitle */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#075e54] dark:text-white">
            {t("auth.loginTitle", "Sign in with email")}
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400 max-w-[310px] mx-auto">
            {t(
              "auth.loginSubtitleRefined",
              "Connect to your omnichannel team inbox. Manage WhatsApp & Telegram customer conversations together.",
            )}
          </p>
        </div>

        {/* Feedback / Error Alerts */}
        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/90 p-3.5 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 backdrop-blur-sm"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{error}</p>
              {verificationRequired && (
                <button
                  type="button"
                  onClick={resendVerificationEmail}
                  disabled={isResending || Boolean(resendMessage)}
                  className="mt-1.5 inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline disabled:opacity-60 text-[#075e54] dark:text-[#25d366]"
                >
                  {isResending ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MailCheck className="h-3.5 w-3.5" />
                  )}
                  {isResending
                    ? t("auth.sending", "Sending…")
                    : t("auth.resendVerification", "Resend verification email")}
                </button>
              )}
              {resendMessage && (
                <p className="mt-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                  {resendMessage}
                </p>
              )}
              {resendError && <p className="mt-1.5">{resendError}</p>}
            </div>
          </div>
        )}

        {/* Authentication Form */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          onChange={clearLoginFeedback}
          className="mt-6 space-y-4"
          aria-busy={isLoading}
          noValidate
        >
          {/* Email Input with WhatsApp Accent */}
          <div>
            <div className="relative rounded-xl bg-[#f0f7f3]/80 dark:bg-[#1f2c33]/70 border border-slate-200/80 dark:border-[#2f3b43] focus-within:border-[#128c7e] dark:focus-within:border-[#25d366] focus-within:ring-4 focus-within:ring-[#25d366]/20 focus-within:bg-white dark:focus-within:bg-[#1f2c33] transition-all">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#128c7e]/70 dark:text-[#25d366]/80" />
              <input
                id="email"
                type="email"
                placeholder={t("auth.emailPlaceholder", "Email")}
                {...register("email")}
                autoComplete="email"
                autoFocus
                className="w-full h-11 pl-10 pr-3.5 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.email.message}
              </p>
            )}
          </div>

          {/* Password Input with Lock Icon & Reveal Toggle */}
          <div>
            <div className="relative rounded-xl bg-[#f0f7f3]/80 dark:bg-[#1f2c33]/70 border border-slate-200/80 dark:border-[#2f3b43] focus-within:border-[#128c7e] dark:focus-within:border-[#25d366] focus-within:ring-4 focus-within:ring-[#25d366]/20 focus-within:bg-white dark:focus-within:bg-[#1f2c33] transition-all">
              <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#128c7e]/70 dark:text-[#25d366]/80" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.password", "Password")}
                {...register("password")}
                autoComplete="current-password"
                className="w-full h-11 pl-10 pr-10 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-[#075e54] dark:hover:text-[#25d366] transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {errors.password.message}
              </p>
            )}

            {/* Forgot Password Link */}
            <div className="mt-2 flex justify-end">
              <Link
                to={buildAuthUrl("/forgot-password", redirectTo, currentEmail)}
                className="text-xs font-medium text-[#0a7c43] hover:text-[#075e54] dark:text-[#25d366] dark:hover:text-[#52df83] transition-colors"
              >
                {t("auth.forgotPasswordLink", "Forgot password?")}
              </Link>
            </div>
          </div>

          {/* Primary Action Button in WhatsApp Teal / Green Gradient */}
          <Button
            type="submit"
            size="lg"
            disabled={isLoading}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-[#075e54] to-[#128c7e] hover:from-[#064e46] hover:to-[#0f776a] text-white dark:from-[#25d366] dark:to-[#00a884] dark:text-[#111b21] font-semibold text-sm shadow-md shadow-[#075e54]/25 hover:shadow-lg hover:shadow-[#075e54]/35 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t("auth.signingIn", "Signing in…")}
              </>
            ) : (
              <>
                {t("auth.getStarted", "Get Started")}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        {/* Security / Encryption Notice */}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-[#0a7c43] dark:text-[#25d366]" />
          <span>{t("auth.secureEncrypted", "All connections are secure and encrypted.")}</span>
        </p>

      </div>
    </GlassAuthShell>
  );
}
