// Build-version comparison for the in-app update prompt.
//
// The app bakes its own build id in at compile time (`__APP_VERSION__`, set by
// the `define` in vite.config.ts) and polls a tiny, always-network-fetched
// `/version.json` to learn when a newer build has shipped. Keeping the decision
// here — a pure function — makes it unit-testable without touching service
// workers, fetch, or the Vue runtime. See useAppUpdate() for the wiring.

export interface RemoteVersion {
  /** Build id the server is currently serving (git short SHA, or a timestamp). */
  version: string;
  /** When true, a client on an older build must be force-updated (blocking). */
  critical?: boolean;
}

export interface UpdateVerdict {
  /** A newer build is available than the one running. */
  updateAvailable: boolean;
  /** The newer build is flagged critical → force it (don't let them ignore it). */
  critical: boolean;
}

/**
 * Decide whether the running build should update, given what the server
 * advertises. Clients only ever lag the server (never lead it), so any version
 * mismatch means "you're behind". `critical` only applies when actually behind.
 */
export function evaluateVersion(local: string, remote: RemoteVersion | null): UpdateVerdict {
  if (!remote || !remote.version) return { updateAvailable: false, critical: false };
  const updateAvailable = remote.version !== local;
  return { updateAvailable, critical: updateAvailable && remote.critical === true };
}
