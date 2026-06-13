/**
 * Stable Node-side scanner boundary for local hosts.
 *
 * Hosts should consume this module instead of importing parser internals from
 * scripts/scan-vscode-sessions.mjs. The returned object is the same normalized
 * SessionData document consumed by the Angular application.
 */
export {
  defaultCodeUserDirs,
  scanVsCodeSessions,
  writeSessionData,
} from '../scripts/scan-vscode-sessions.mjs';
