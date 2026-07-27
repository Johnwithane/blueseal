// ---------------------------------------------------------------------------
// Launch flags — the single place where whole features are hidden for launch.
//
// Philosophy: HIDE, don't remove. Flipping a flag back on is a one-line diff
// (or a VITE_LAUNCH_* env override at build time, no code change at all).
// Flags gate ENTRY POINTS — nav items, role switchers, dashboard tabs, CTAs —
// not routes or data. Deep links keep working so anyone mid-flight in a
// hidden flow (an open job post, a claimed invite) is never stranded, and
// nothing server-side changes shape.
//
// Why these are off (2026-07 launch simplification): tradespeople are running
// real jobs through the app today — with or without their client in the app.
// The launch surface is the Airbnb-simple loop: client requests / tradie
// creates job → run the job → invoice → review. Everything else waits for
// real demand. See the commit that introduced this file for the full audit.
// ---------------------------------------------------------------------------

// import.meta.env only exists under Vite. This module is also loaded by the
// Node-side prerender script (via src/data/help.ts → src/seo/content.ts), so
// fall back to an empty env there — prerendered pages get the code defaults,
// which are the same ones the shipped bundle uses unless a VITE_LAUNCH_*
// override is set at build time.
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function envFlag(key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

export const LAUNCH = {
  /** Project manager role: cockpit, properties/projects, PM commission. */
  projectManagerRole: envFlag("VITE_LAUNCH_PM_ROLE", false),
  /** Sales rep role: referral codes, rep vetting console, rep commission. */
  salesRole: envFlag("VITE_LAUNCH_SALES_ROLE", false),
  /** Job board marketplace: post-a-job, browse, bid-blind applications. */
  jobBoard: envFlag("VITE_LAUNCH_JOB_BOARD", false),
  /** Peer recommendations ("vouches") — second reputation system. */
  vouches: envFlag("VITE_LAUNCH_VOUCHES", false),
  /** AI assistant bubble + AI chat tab + AI drafting. Receipt OCR stays on
   *  regardless — it's the free acquisition hook, gated separately server-side. */
  aiAssistant: envFlag("VITE_LAUNCH_AI_ASSISTANT", false),
  /** Pro business tools: Reports, Clients CRM + recurring billing. */
  proTools: envFlag("VITE_LAUNCH_PRO_TOOLS", false),
  /** Read-only kanban Board tab on the tradesperson dashboard. */
  kanbanBoard: envFlag("VITE_LAUNCH_KANBAN_BOARD", false),
} as const;

export type LaunchFlag = keyof typeof LAUNCH;
