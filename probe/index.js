/**
 * Session Palette Probe — host half.
 *
 * The probe is entirely browser-side: every question it answers (projection
 * coverage in the session list, client Service resolution, and whether a
 * `registerFixed` chord reaches the page on macOS Electron) is observable from
 * the page. The Host therefore contributes nothing but the Loader row that
 * gives the client half a home, and the row's id is the namespace the client
 * half registers its slot cell and locale dictionary under.
 *
 * @module dsh-plugin-session-palette-probe
 */

/** Mount the bundle row. The browser half does all the work. */
export function apply() {}
