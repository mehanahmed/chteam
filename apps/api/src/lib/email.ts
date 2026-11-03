import { env } from "./env.js";
import {
  deliverEmail,
  type EmailOptions,
  type EmailResult,
} from "./mail/index.js";
import {
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
  type BrandedEmailContent,
} from "./email-template.js";

export type { EmailOptions, EmailResult } from "./mail/index.js";

/** Deliver a composed email through the configured mail driver. */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  return deliverEmail(options);
}

/**
 * Send email verification link
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  invitationToken?: string,
): Promise<EmailResult> {
  const verificationUrl = new URL("/verify-email", env.APP_URL);
  verificationUrl.searchParams.set("token", token);
  if (invitationToken) {
    verificationUrl.searchParams.set("invitation", invitationToken);
  }
  const verificationUrlString = verificationUrl.toString();
  const content: BrandedEmailContent = {
    preheader: invitationToken
      ? "Confirm your email address to continue to your workspace invitation."
      : "Confirm your email address to finish setting up CHTeam.",
    eyebrow: "Account security",
    title: "Verify your email address",
    paragraphs: [
      invitationToken
        ? "Confirm your email address to finish creating your account and continue to the workspace invitation."
        : "Thanks for signing up. Confirm your email address to finish setting up your CHTeam account.",
    ],
    action: { label: "Verify email", url: verificationUrlString },
    note: "This link expires in 24 hours. If you did not create this account, you can safely ignore this email.",
  };

  return sendEmail({
    to: email,
    subject: "Verify your email address",
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<EmailResult> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
  const content: BrandedEmailContent = {
    preheader: "Use this secure link to choose a new CHTeam password.",
    eyebrow: "Account security",
    title: "Reset your password",
    paragraphs: [
      "We received a request to reset the password for your CHTeam account.",
      "Use the secure link below to choose a new password.",
    ],
    action: { label: "Reset password", url: resetUrl },
    note: "This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email; your password will not change.",
  };

  return sendEmail({
    to: email,
    subject: "Reset your password",
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}

export interface SendInvitationEmailOptions {
  temporaryPassword?: string;
  isExistingAccount?: boolean;
}

/**
 * Send company invitation email with direct login link & credentials
 */
export async function sendInvitationEmail(
  email: string,
  token: string,
  companyName: string,
  inviterEmail: string,
  options?: SendInvitationEmailOptions | string,
): Promise<EmailResult> {
  const loginUrl = `${env.APP_URL}/login`;
  const inviteUrl = `${env.APP_URL}/invite/${token}`;
  const safeCompanyName = emailHeaderText(companyName);

  const temporaryPassword =
    typeof options === "string" ? options : options?.temporaryPassword;
  const isExistingAccount =
    typeof options === "object" ? options?.isExistingAccount : false;

  const details: Array<{ label: string; value: string }> = [
    { label: "Workspace", value: companyName },
    { label: "Invited by", value: inviterEmail },
    { label: "Email / Username", value: email },
  ];

  if (temporaryPassword) {
    details.push({ label: "Temporary Password", value: temporaryPassword });
  } else if (isExistingAccount) {
    details.push({
      label: "Password",
      value: "Use your existing account password",
    });
  }

  const calloutText = temporaryPassword
    ? `Login Link: ${loginUrl}\nEmail: ${email}\nPassword: ${temporaryPassword}`
    : `Login Link: ${loginUrl}\nEmail: ${email}`;

  const content: BrandedEmailContent = {
    preheader: `Your login credentials for ${safeCompanyName} on CHTeam.`,
    eyebrow: "Team Invitation & Login Credentials",
    title: `Welcome to ${safeCompanyName}`,
    paragraphs: [
      `You have been invited by ${inviterEmail} to join the ${safeCompanyName} workspace on CHTeam.`,
      temporaryPassword
        ? "Your account has been created. You can log in immediately with the credentials below:"
        : "Your account has access. You can log in directly using the link below:",
    ],
    details,
    callout: {
      label: "LOGIN CREDENTIALS",
      text: calloutText,
    },
    action: { label: "Log In to Workspace", url: loginUrl },
    note: temporaryPassword
      ? "You can log in directly using the credentials above. For security, we recommend changing your password from your Profile settings after your first login."
      : "If you do not remember your password, you can use the 'Forgot password?' option on the login page.",
  };

  return sendEmail({
    to: email,
    subject: `Login Credentials & Invitation to ${safeCompanyName}`,
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}
