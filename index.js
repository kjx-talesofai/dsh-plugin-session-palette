/**
 * Session Palette — host half.
 *
 * The feature is browser-side, but the Host owns the two settings the browser
 * cannot persist for itself. `Config` below is the plugin's settings schema, and
 * `dsh-settings` derives its namespace from this row's Loader id
 * (`session-palette`), so the fields are reachable from the page as
 * `ctx.configForms.get('session-palette')` and land in the profile's
 * `cordis.patch.yml` next to every other Host-backed preference.
 *
 * `.volatile()` is required, not decorative: only volatile fields are exposed to
 * the page's settings scope and accepted on write. Without it the schema has no
 * volatile field and the namespace does not appear at all.
 *
 * There is no `webserver/index-inject` listener here, unlike a theme plugin: the
 * shortcut claim happens after the shell mounts, so nothing needs to reach the
 * page before its first script runs.
 *
 * @module dsh-plugin-session-palette
 */

import z from '@deepseek-ai/schemastery'

/**
 * Live behaviour switches.
 *
 * `takeOver` is deliberately true by default: the plugin exists to change what
 * ⌘K does, so shipping it disabled would mean installing it and seeing nothing.
 * It is a setting rather than a constant so the trade is reversible without
 * uninstalling — and because the claim is what disables the shipped
 * `session.search` chord, which a user may want back.
 *
 * There is deliberately no second switch for "keep the shipped search usable":
 * the palette writes no shortcut preference at all, so turning `takeOver` off
 * restores the shipped default exactly. The shipped search keeps its mouse entry
 * either way, and the capability it provided — content search — belongs in the
 * palette rather than on a second chord.
 */
export const Config = z.object({
  takeOver: z.boolean().default(true).volatile(),
})

/**
 * Mount the bundle row.
 *
 * Both settings are read and written by the browser half through
 * `ctx.configForms`; the Host contributes nothing else.
 */
export function apply() {}
