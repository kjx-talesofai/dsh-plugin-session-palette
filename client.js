/**
 * Session Palette — browser half.
 *
 * One slot contribution and one shortcut claim, under the harness's own
 * module-loader wrapper (`window.__ModuleLoader__.load({ id, factory })`) so the
 * package needs no build step: this file IS the shipped client bundle.
 *
 *   `shell.overlay` — the frame-wide floating seat, registered as `role="dialog"
 *   aria-modal="true"`. That role is not decoration: the host's `modalSelector`
 *   is `[role="dialog"][aria-modal="true"], [role="menu"]`, and both the Escape
 *   arbitration stack and the shortcut service's background-command blocking key
 *   off it. Rendering it is what makes the palette modal.
 *
 *   A FIXED shortcut binding — how ⌘K is taken. `ctx.shortcuts.register` refuses
 *   any default that overlaps `session.search`'s (`Conflicting shortcut
 *   defaults`), and registration happens once against defaults that another
 *   plugin already owns, so the chord cannot be claimed by registering a command.
 *   (Disposers do exist — the obstacle is the conflict check, not a missing API.) `registerFixed` performs no conflict check; the fixed
 *   binding then makes `session.search` *conflicted*, which is what removes
 *   `meta+KeyK` from the Electron main process's natively intercepted set,
 *   letting the DOM keydown survive to this page. The fixed observer runs before
 *   configurable dispatch and consumes the chord. No preference file is written.
 *   This was verified end to end against the running app before the palette was
 *   written — see docs/plan.md §10.
 *
 * Why the preview is not simply free: `turnOutline` (last prompt, last response,
 * per turn) rides the projection cache into the session list, but measured
 * coverage is 66% — and the rows without it are the *old* sessions, which is
 * exactly what a palette is for. So the highlighted row lazily refreshes its
 * projections after a short dwell, one request at a time.
 *
 * @module dsh-plugin-session-palette/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-session-palette',
  factory(require) {
    const React = require('react')

    const h = React.createElement

    /**
     * The baseline primitive table, when the loader has it.
     *
     * `MenuItemButton` is what gives a session-menu row the shipped padding, hover
     * and icon slot — a hand-rolled button beside Pin/Rename/Fork/Archive reads as
     * bolted on. It is resolved optionally because the table is a loader external,
     * not a dependency: if it is missing, the row falls back to its own button
     * rather than taking the whole bundle down.
     */
    const MenuItemButton = (() => {
      try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
        return typeof primitives?.MenuItemButton === 'function' ? primitives.MenuItemButton : null
      } catch (error) {
        return null
      }
    })()

    /**
     * A tag glyph drawn in the shipped outline style.
     *
     * The table has no tag icon, and borrowing an unrelated one (a bookmark, a
     * star) would say the wrong thing; this is the same 16-unit box, 1.4 stroke and
     * `currentColor` as its neighbours.
     */
    const tagIcon = () =>
      h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M8.6 2.6H4a1.4 1.4 0 0 0-1.4 1.4v4.6l6.3 6.3a1 1 0 0 0 1.4 0l4.1-4.1a1 1 0 0 0 0-1.4L8.6 2.6z',
        }),
        h('circle', { cx: 5.6, cy: 5.6, r: 1, fill: 'currentColor', stroke: 'none' }),
      )

    /** Locale namespace; also the slot registration's `locale` key. */
    const NS = 'dsh-plugin-session-palette'

    /**
     * Loader row id.
     *
     * `dsh-settings` derives the plugin's settings namespace from its row id, so
     * this must equal `id:` in `cordis.patch.yml` (`session-palette`).
     */
    const ROW_ID = 'session-palette'

    /** The frame-wide floating seat. */
    const SLOT = 'shell.overlay'

    /**
     * Fixed-command id.
     *
     * The dotted shape is load-bearing. `protocol.js` validates ids against
     * `/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/`, and an id that fails
     * it makes the desktop definitions IPC reject the whole catalog, flipping the
     * shortcuts config to `unreadable` and silently disabling every keyboard
     * command in the app.
     */
    const FIXED_ID = 'session-palette.toggle'

    /**
     * Editable companion command.
     *
     * Registered with no default binding, so it never collides with anything and
     * the user can attach a chord of their own in Settings → Shortcuts. It gives
     * the fixed binding — which is read-only by construction — a way out.
     */
    const COMMAND_ID = 'session.palette'

    /** The chord the palette claims. */
    const HOTKEY = { code: 'KeyK', modifiers: ['primary'] }

    /** The host's own modal arbitration selector, copied verbatim. */
    const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"]'

    /**
     * Retain source for a rename.
     *
     * `sessions.retain`/`using` take a `source` key that is used only for
     * accounting — it becomes one counter in `retainInfo(id).retainedBy`, and the
     * runtime never validates it (the shipped workspace half passes its own
     * `workspaceOperation`). Naming this plugin is what makes an unexpected
     * retain attributable in a diagnostic dump instead of looking like a leak.
     */
    const RENAME_SOURCE = 'sessionPalette'

    /**
     * The conversation header's current-session title.
     *
     * A CSS-module class, so the hash in front of it changes between builds —
     * matching on the suffix instead of the whole name is what keeps this working
     * across DSH upgrades. `crumbCurrent` is also used for the placeholder shown
     * when no Session is selected, and that case dies one guard later because
     * there is no current Session to rename.
     */
    const TITLE_SELECTOR = '[class*="crumbCurrent"]'

    /**
     * Tag colours, as theme tokens rather than hex.
     *
     * Five, not twelve: a personal vocabulary stays readable when the colours are
     * a small closed set, and each one maps to a token the theme already ships, so
     * light, dark and a third-party token layer all follow.
     */
    const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'gray']

    /** Colour name → token. Unknown names fall back to the idle token. */
    const TAG_COLOR_TOKEN = {
      blue: 'var(--dsw-alias-state-business-primary)',
      green: 'var(--dsw-alias-state-success-primary)',
      amber: 'var(--dsw-alias-state-warn-primary)',
      red: 'var(--dsw-alias-state-error-primary)',
      gray: 'var(--dsw-alias-state-idle-primary)',
    }

    /** A session carries at most this many tags. */
    const MAX_TAGS = 3

    /** Present with nothing in it, for a Host whose schema predates tags. */
    const EMPTY_TAGS = { ready: false, vocabulary: [], assignments: {} }

    /** Rows rendered before the list is truncated, to keep 1500+ sessions cheap. */
    const ROW_LIMIT = 200

    /**
     * The view ring `Tab` walks.
     *
     * Each entry is a different question about the same dataset — what is
     * happening, what did I keep, what did I put away — so they are views rather
     * than sections of one list. `Tab` cycles forwards and `⇧Tab` backwards.
     */
    const VIEWS = ['recents', 'pinned', 'archived']

    /** How long the highlight must rest on a row before its projections load. */
    const PROJECTION_DWELL_MS = 200

    /** How long an inline notice stays before it clears itself. */
    const NOTICE_MS = 4000

    //#region store

    /** Shallow equality over own enumerable keys; stops a refresh loop. */
    function shallowEqual(left, right) {
      if (Object.is(left, right)) return true
      if (typeof left !== 'object' || left === null) return false
      if (typeof right !== 'object' || right === null) return false
      const leftKeys = Object.keys(left)
      const rightKeys = Object.keys(right)
      if (leftKeys.length !== rightKeys.length) return false
      for (const key of leftKeys) {
        if (!Object.is(left[key], right[key])) return false
      }
      return true
    }

    /**
     * Tiny SnapshotStore stand-in.
     *
     * The palette renders with `useSyncExternalStore`, which needs a stable
     * `getSnapshot` identity and a `subscribe` that returns a disposer. Rolling it
     * here keeps the bundle down to a single `react` require.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      const emit = () => {
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            console.error(`${NS}: listener failed`, error)
          }
        }
      }
      const commit = (next) => {
        if (shallowEqual(next, value)) return
        value = next
        emit()
      }
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: commit,
        update: (mutate) => {
          commit(mutate(value))
        },
      }
    }

    /** `useSyncExternalStore` with a subscription fallback, chosen once. */
    const useStore =
      typeof React.useSyncExternalStore === 'function'
        ? (store) =>
            React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
        : (store) => {
            const [value, setValue] = React.useState(store.getSnapshot)
            React.useEffect(() => {
              setValue(store.getSnapshot())
              return store.subscribe(() => setValue(store.getSnapshot()))
            }, [store])
            return value
          }

    //#endregion

    //#region fuzzy matching

    // Copied from @deepseek-ai/dsh-client-ui-primitives (`boundaryBonus` and
    // `alignmentScore`). A plugin must not import another plugin's component
    // package, so the matcher is reproduced rather than reached for — and
    // reproducing it is what makes the palette rank exactly like the host's own
    // `/` menu.

    /** Word-boundary bonus: the start of the name, or after `-` / `_`. */
    function boundaryBonus(name, index) {
      return index === 0 || name.charAt(index - 1) === '-' || name.charAt(index - 1) === '_' ? 8 : 0
    }

    /**
     * Score the strongest ordered-subsequence alignment in O(name × query).
     *
     * @returns the score, or undefined when the query is not a subsequence.
     */
    function alignmentScore(name, query) {
      if (query.length > name.length) return undefined
      const noMatch = Number.NEGATIVE_INFINITY
      let previous = Array(name.length).fill(noMatch)
      for (let index = 0; index < name.length; index += 1) {
        if (name.charAt(index) === query.charAt(0)) {
          previous[index] = 1 + boundaryBonus(name, index) - index
        }
      }
      for (let queryIndex = 1; queryIndex < query.length; queryIndex += 1) {
        const current = Array(name.length).fill(noMatch)
        let left = noMatch
        let leftLeft = noMatch
        let bestGapped = noMatch
        for (let index = 0; index < name.length; index += 1) {
          const prior = previous[index]
          if (leftLeft !== noMatch) bestGapped = Math.max(bestGapped, leftLeft + index - 2)
          if (name.charAt(index) === query.charAt(queryIndex)) {
            const bonus = 1 + boundaryBonus(name, index)
            let score = noMatch
            if (left !== noMatch) score = left + bonus + 4
            if (bestGapped !== noMatch) score = Math.max(score, bestGapped + bonus + 1 - index)
            current[index] = score
          }
          leftLeft = left
          left = prior
        }
        previous = current
      }
      let best = noMatch
      for (const score of previous) best = Math.max(best, score)
      return best === noMatch ? undefined : best
    }

    /**
     * Rank one candidate against a query over several keys.
     *
     * Mirrors the host ranker's precedence: a prefix hit beats a higher alignment
     * score, which beats source order (applied by the caller).
     *
     * @param keys - candidate strings; the best match wins.
     * @param query - already lowercased and non-blank.
     * @returns `{ prefix, score }`, or undefined when no key matches.
     */
    function rankCandidate(keys, query) {
      let prefix = false
      let score
      for (const key of keys) {
        if (typeof key !== 'string' || key === '') continue
        const lower = key.toLowerCase()
        const candidate = alignmentScore(lower, query)
        if (candidate === undefined) continue
        if (lower.startsWith(query)) prefix = true
        score = score === undefined ? candidate : Math.max(score, candidate)
      }
      return score === undefined ? undefined : { prefix, score }
    }

    //#endregion

    //#region time

    const MINUTE = 60 * 1000
    const HOUR = 60 * MINUTE
    const DAY = 24 * HOUR

    /**
     * Which recency group a timestamp falls in.
     *
     * Buckets are calendar-anchored at local midnight, so "yesterday" means the
     * previous calendar day rather than "24 to 48 hours ago" — which is what a
     * reader expects from a list headed "Yesterday".
     */
    function bucketOf(timestamp, now) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return 'older'
      const midnight = new Date(now)
      midnight.setHours(0, 0, 0, 0)
      const today = midnight.getTime()
      if (timestamp >= today) return 'today'
      if (timestamp >= today - DAY) return 'yesterday'
      if (timestamp >= today - 7 * DAY) return 'week'
      if (timestamp >= today - 30 * DAY) return 'month'
      return 'older'
    }

    /**
     * Compact elapsed-time label, matching the sidebar's granularity.
     *
     * @returns a locale key plus its optional `n`, so the caller renders
     *   localized text rather than concatenating.
     */
    function agoParts(timestamp, now) {
      const delta = now - timestamp
      if (!Number.isFinite(delta) || delta < MINUTE) return { key: 'ago.now' }
      if (delta < HOUR) return { key: 'ago.min', n: Math.floor(delta / MINUTE) }
      if (delta < DAY) return { key: 'ago.hour', n: Math.floor(delta / HOUR) }
      if (delta < 30 * DAY) return { key: 'ago.day', n: Math.floor(delta / DAY) }
      if (delta < 365 * DAY) return { key: 'ago.month', n: Math.floor(delta / (30 * DAY)) }
      return { key: 'ago.year', n: Math.floor(delta / (365 * DAY)) }
    }

    /** Render an elapsed-time label through a translate function. */
    function agoText(t, timestamp, now) {
      const parts = agoParts(timestamp, now)
      return parts.n === undefined ? t(parts.key) : t(parts.key, { n: parts.n })
    }

    //#endregion

    //#region session derivation

    /** The session's own last path segment — the label the sidebar falls back to. */
    function folderLabel(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return ''
      const trimmed = cwd.replace(/[/\\]+$/, '')
      const parts = trimmed.split(/[/\\]/)
      return parts[parts.length - 1] ?? ''
    }

    /**
     * Map each session id to its owning workspace title.
     *
     * First writer wins: a session belongs to one workspace, but a stale record
     * could still list it, and the sidebar resolves membership the same way.
     */
    function workspaceTitles(workspaceItems) {
      const map = new Map()
      const items = Array.isArray(workspaceItems) ? workspaceItems : []
      for (const workspace of items) {
        const title =
          typeof workspace.title === 'string' && workspace.title.trim() !== ''
            ? workspace.title
            : folderLabel(workspace.path)
        const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
        for (const id of ids) if (!map.has(id)) map.set(id, title)
      }
      return map
    }

    /**
     * How many direct children of this session are running.
     *
     * A parent whose child is working is not idle, and the sidebar shows it the
     * same way, so the palette's activity tier has to agree.
     */
    function runningChildCount(list, id, statuses) {
      const catalog = list?.projectionsBySession?.[id]?.values?.subagentCatalog
      if (!Array.isArray(catalog)) return 0
      let count = 0
      for (const child of catalog) {
        const childId = child?.id
        if (childId === undefined) continue
        const status = statuses?.get?.(childId)
        const running = status?.running ?? list?.byId?.[childId]?.running
        if (running === true) count += 1
      }
      return count
    }

    /**
     * Activity tier: lower sorts first, and only the top three are "active".
     *
     * `updatedAt` is `max(createdAt, lastPromptAt)` — the last time the *user*
     * wrote, not the last time the session changed. An agent reply does not move
     * it. Pure recency therefore buries exactly the sessions worth surfacing, so
     * live state is ranked ahead of the clock.
     */
    function tierOf(running, pendingKind, unread) {
      if (pendingKind !== undefined) return 0
      if (running) return 1
      if (unread) return 2
      return 3
    }

    /**
     * Map a pending-interaction kind onto its dictionary key.
     *
     * An unrecognized kind still counts as "needs you" — a future interaction
     * type must not silently demote a blocked session to the ordinary list.
     */
    function pendingKey(kind) {
      if (kind === 'approval') return 'status.approval'
      if (kind === 'plan-review') return 'status.planReview'
      if (kind === 'question') return 'status.question'
      return 'status.waiting'
    }

    /**
     * Why a session is, or is not, part of the palette's browse list.
     *
     * `ctx.sessions.list` is the raw store: it carries every subagent run (each
     * one creates a session), the provisional blank New Session row, and archived
     * sessions. The sidebar filters all three out, and so does the palette — so
     * the palette's own count must come from this classification rather than from
     * `ids.length`, which counts what the user cannot see.
     *
     * @param row - a session list row.
     * @param isArchived - whether the archive set holds it.
     * @returns the exclusion reason, or `'listed'`.
     */
    function classify(row, isArchived) {
      if (row.blank === true) return 'blank'
      if (row.origin === 'subagent') return 'subagent'
      if (isArchived) return 'archived'
      return 'listed'
    }

    /** DOM-safe element id fragment; session ids are opaque strings. */
    function domSafe(value) {
      return String(value).replace(/[^A-Za-z0-9_-]/g, '_')
    }

    /**
     * Order two decorated rows.
     *
     * With a query, match quality leads and activity only breaks ties: an exact
     * title the user typed must not lose to an unrelated session that merely
     * happens to be running. Activity leads only the unqueried list, which is the
     * case the ordering was actually asked for.
     *
     * @param left - a decorated row.
     * @param right - a decorated row.
     * @param hasQuery - whether the current list is query-ranked.
     */
    /**
     * Order two rows in the recency view.
     *
     * A pin is deliberately absent here. The drawer is a separate view rather
     * than a boosted section, so a flag set months ago neither outranks today's
     * work nor nudges a search result: it only changes *where you can find it*.
     *
     * With a query, match quality leads and urgency breaks ties; otherwise
     * urgency leads and recency breaks ties.
     */
    function compareRows(left, right, hasQuery) {
      if (hasQuery) {
        const leftPrefix = left.rank.prefix ? 1 : 0
        const rightPrefix = right.rank.prefix ? 1 : 0
        if (leftPrefix !== rightPrefix) return rightPrefix - leftPrefix
        if (left.rank.score !== right.rank.score) return right.rank.score - left.rank.score
      }
      if (left.tier !== right.tier) return left.tier - right.tier
      return compareByRecency(left, right)
    }

    /**
     * Newest first, with the session id as a stable tie-break.
     *
     * Also the whole ordering of the archive view: an archived session cannot be
     * running or waiting for anything, so its activity tier carries no meaning.
     */
    function compareByRecency(left, right) {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
      return left.id < right.id ? -1 : 1
    }

    /**
     * Order the pin drawer.
     *
     * `pinnedSessionIds` is documented as pin order, most recently pinned first,
     * which answers "what did I last decide to keep?" better than a clock agent
     * replies never advance — and it keeps the drawer from reshuffling itself as
     * you work.
     */
    function comparePinned(left, right) {
      if (left.pinIndex !== right.pinIndex) return left.pinIndex - right.pinIndex
      return left.id < right.id ? -1 : 1
    }

    //#endregion

    //#region tags

    /**
     * Clean the stored vocabulary.
     *
     * Config is a file a human can edit, so every field is treated as untrusted:
     * a tag without a usable id or label is dropped rather than rendered as an
     * empty pill, and an unknown colour falls back instead of inventing a hex.
     *
     * @param raw - the `tags` field, or anything else.
     * @returns the usable vocabulary, in stored order.
     */
    function normalizeVocabulary(raw) {
      if (!Array.isArray(raw)) return []
      const seen = new Set()
      const out = []
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue
        const id = typeof entry.id === 'string' ? entry.id.trim() : ''
        const label = typeof entry.label === 'string' ? entry.label.trim() : ''
        if (id === '' || label === '' || seen.has(id)) continue
        seen.add(id)
        out.push({
          id,
          label,
          emoji: typeof entry.emoji === 'string' ? entry.emoji.trim() : '',
          color: typeof entry.color === 'string' && entry.color in TAG_COLOR_TOKEN ? entry.color : 'gray',
        })
      }
      return out
    }

    /**
     * Clean the stored assignments.
     *
     * Entries with no tags are dropped, unknown tag ids are dropped, and the
     * three-tag ceiling is enforced on read as well as on write — a hand-edited
     * config cannot smuggle in a fourth tag.
     *
     * @param raw - the `assignments` field, or anything else.
     * @param known - ids that exist in the vocabulary.
     * @returns `{ sessionId: string[], ... }` with only populated sessions.
     */
    function normalizeAssignments(raw, known) {
      const out = {}
      if (!Array.isArray(raw)) return out
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue
        const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : ''
        if (sessionId === '') continue
        const ids = Array.isArray(entry.tags) ? entry.tags : []
        const kept = []
        for (const id of ids) {
          if (typeof id !== 'string' || !known.has(id) || kept.includes(id)) continue
          kept.push(id)
          if (kept.length === MAX_TAGS) break
        }
        if (kept.length > 0) out[sessionId] = kept
      }
      return out
    }

    /**
     * A new tag's id, derived from its label.
     *
     * Identity is the id, so a label can be edited later without orphaning the
     * sessions that point at it. The suffix keeps two tags with the same label in
     * different languages from colliding.
     *
     * @param label - the user's text.
     * @param taken - ids already in use.
     * @returns a unique id.
     */
    function tagIdFor(label, taken) {
      const stem =
        label
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/gu, '') || 'tag'
      let id = stem
      let index = 2
      while (taken.has(id)) {
        id = `${stem}-${index}`
        index += 1
      }
      return id
    }

    /**
     * Write one session's tags into the assignment list.
     *
     * @param assignments - the normalized map.
     * @param sessionId - whose tags changed.
     * @param ids - the complete new list (empty removes the entry).
     * @returns the flat list the Config field expects.
     */
    function withAssignment(assignments, sessionId, ids) {
      const next = { ...assignments }
      if (ids.length === 0) delete next[sessionId]
      else next[sessionId] = ids.slice(0, MAX_TAGS)
      return assignmentList(next)
    }

    /**
     * The flat list the Config field stores, from the map the code works with.
     *
     * Sorted by session id so a write is stable: the same tags always serialize to
     * the same bytes, which keeps the config diff (and therefore the plugin's
     * update check) from seeing a change when nothing changed.
     *
     * @param assignments - `{ sessionId: tagIds[] }`.
     * @returns `[{ sessionId, tags }]`.
     */
    function assignmentList(assignments) {
      return Object.keys(assignments)
        .sort()
        .map((id) => ({ sessionId: id, tags: assignments[id] }))
    }

    //#endregion

    //#region dictionaries

    const DICT = {
      en: {
        'palette.aria': 'Session palette',
        'palette.placeholder': 'Search sessions',
        'palette.empty': 'No matching sessions',
        'palette.emptyHint': 'Try a shorter query.',
        'palette.none': 'No sessions yet',
        'palette.count': '{n} sessions',
        'view.recents': 'Recents',
        'view.pinned': 'Pinned {n}',
        'view.archived': 'Archived {n}',
        'view.hint': 'tab switches',
        'pinned.empty': 'The drawer is empty',
        'pinned.emptyHint': 'Press ⌘⇧P on a row to keep it here',
        'pinned.emptyMatch': 'No pinned session matches',
        'archived.empty': 'Nothing archived',
        'archived.emptyMatch': 'No archived session matches',
        'archived.emptyHint': 'Press ⌘⇧⌫ on a row to put it away',
        'archived.restoreHint': 'Archived sessions cannot be opened. Press ⌘⇧⌫ to restore.',
        'palette.subagentHidden': '{n} subagent runs',
        'notice.undo': 'Undo',
        'palette.truncated': 'showing {shown} of {total}',
        'group.needsYou': 'Needs you',
        'group.active': 'Active',
        'group.today': 'Today',
        'group.yesterday': 'Yesterday',
        'group.week': 'Previous 7 days',
        'group.month': 'Previous 30 days',
        'group.older': 'Older',
        'status.approval': 'Waiting for approval',
        'status.planReview': 'Plan awaiting review',
        'status.question': 'Waiting for answer',
        'status.waiting': 'Waiting for you',
        'status.running': 'Running',
        'status.unread': 'Finished, unread',
        'status.pinned': 'Pinned',
        'status.archived': 'Archived',
        'ago.now': 'now',
        'ago.min': '{n}m',
        'ago.hour': '{n}h',
        'ago.day': '{n}d',
        'ago.month': '{n}mo',
        'ago.year': '{n}y',
        'preview.you': 'You last spoke {ago} ago',
        'preview.youNow': 'You last spoke just now',
        'preview.prompt': 'You',
        'preview.response': 'DSH',
        'preview.loading': 'Loading the last turn…',
        'preview.none': 'No turns recorded yet',
        'preview.unavailable': 'Press ⏎ to read this one',
        'preview.footer':
          '↑↓ move · ⏎ open · tab drawer · ⌘⇧R rename · ⌘⇧T tag · ⌘⇧P pin · ⌘⇧⌫ archive · esc',
        'archived.open': 'Archived — restore it first',
        'pin.archived': 'Archived sessions cannot be pinned',
        'archived.done': 'Archived',
        'archived.droppedPin': 'Archived, and unpinned',
        'unarchive.done': 'Restored',
        'archive.failed': 'Could not change the archive state',
        'pin.done': 'Pinned',
        'unpin.done': 'Unpinned',
        'pin.failed': 'Could not change the pin',
        'rename.aria': 'Session title',
        'rename.placeholder': 'Give this session a name',
        'rename.hint': '⏎ save · esc cancel',
        'rename.bar': 'Renaming “{title}”',
        'rename.done': 'Renamed to “{title}”',
        'rename.failed': 'Could not rename: {reason}',
        'rename.unavailable': 'the session did not respond',
        'tags.aria': 'Tags',
        'tags.hint': '⏎ toggle · esc done',
        'tags.bar': 'Tagging “{title}” · {n}/3',
        'mode.locked': 'the list is locked while this is open',
        'tags.empty': 'No tags yet',
        'tags.emptyHint': 'Type a name and press ⏎ to create it.',
        'tags.create': 'Create “{label}”',
        'tags.full': 'Three tags is the limit',
        'tags.manage': 'Tags…',
        'tags.clear': 'Clear',
        'tags.notReady': 'Tags need one DSH restart',
        'tags.notReadyHint':
          'This running Host predates the tag store, so a tag could not be saved. Restart DSH once.',
        'tags.failed': 'Could not save the tag',
        'tags.count': '{n}',
      },
      zh: {
        'palette.aria': '会话面板',
        'palette.placeholder': '搜索会话',
        'palette.empty': '无匹配会话',
        'palette.emptyHint': '试试更短的词。',
        'palette.none': '还没有会话',
        'palette.count': '{n} 个会话',
        'view.recents': '最近',
        'view.pinned': '置顶 {n}',
        'view.archived': '归档 {n}',
        'view.hint': 'tab 切换',
        'pinned.empty': '抽屉是空的',
        'pinned.emptyHint': '在列表里按 ⌘⇧P 把它放进来',
        'pinned.emptyMatch': '置顶里没有匹配',
        'archived.empty': '还没有归档的会话',
        'archived.emptyMatch': '归档里没有匹配',
        'archived.emptyHint': '在列表里按 ⌘⇧⌫ 把它收起来',
        'archived.restoreHint': '归档会话不能直接打开，按 ⌘⇧⌫ 恢复。',
        'palette.subagentHidden': '{n} 个子 agent 运行',
        'notice.undo': '撤销',
        'palette.truncated': '显示 {shown} / {total}',
        'group.needsYou': '需要你',
        'group.active': '活跃',
        'group.today': '今天',
        'group.yesterday': '昨天',
        'group.week': '过去 7 天',
        'group.month': '过去 30 天',
        'group.older': '更早',
        'status.approval': '等待审批',
        'status.planReview': '计划待复核',
        'status.question': '等待回答',
        'status.waiting': '等你处理',
        'status.running': '运行中',
        'status.unread': '已完成未读',
        'status.pinned': '已置顶',
        'status.archived': '已归档',
        'ago.now': '刚刚',
        'ago.min': '{n} 分钟',
        'ago.hour': '{n} 小时',
        'ago.day': '{n} 天',
        'ago.month': '{n} 个月',
        'ago.year': '{n} 年',
        'preview.you': '你 {ago}前发言',
        'preview.youNow': '你刚刚发言',
        'preview.prompt': '你',
        'preview.response': 'DSH',
        'preview.loading': '正在载入最后一个 turn…',
        'preview.none': '还没有 turn',
        'preview.unavailable': '按 ⏎ 进去看',
        'preview.footer':
          '↑↓ 移动 · ⏎ 打开 · tab 抽屉 · ⌘⇧R 改名 · ⌘⇧T 标签 · ⌘⇧P 置顶 · ⌘⇧⌫ 归档 · esc',
        'archived.open': '已归档，需先恢复',
        'pin.archived': '归档会话不能置顶',
        'archived.done': '已归档',
        'archived.droppedPin': '已归档（置顶已移除）',
        'unarchive.done': '已恢复',
        'archive.failed': '没能改变归档状态',
        'pin.done': '已置顶',
        'unpin.done': '已取消置顶',
        'pin.failed': '没能改变置顶状态',
        'rename.aria': '会话标题',
        'rename.placeholder': '给这个会话起个名字',
        'rename.hint': '⏎ 保存 · esc 取消',
        'rename.bar': '正在改名：「{title}」',
        'rename.done': '已改名为「{title}」',
        'rename.failed': '改名失败：{reason}',
        'rename.unavailable': '会话没有响应',
        'tags.aria': '标签',
        'tags.hint': '⏎ 切换 · esc 完成',
        'tags.bar': '正在打标签：「{title}」 · {n}/3',
        'mode.locked': '这个模式下列表是锁的',
        'tags.empty': '还没有标签',
        'tags.emptyHint': '输入一个名字，按 ⏎ 新建。',
        'tags.create': '新建「{label}」',
        'tags.full': '最多 3 个标签',
        'tags.manage': '标签…',
        'tags.clear': '清除',
        'tags.notReady': '标签需要重启一次 DSH',
        'tags.notReadyHint': '当前跑着的这版 host 还没有标签存储，写什么都存不下来。',
        'tags.failed': '标签没存上',
        'tags.count': '{n}',
      },
    }

    //#endregion

    //#region styles

    /**
     * Palette CSS.
     *
     * Token-only, like the rest of the plugin: every colour is a `--dsw-*` alias,
     * so light, dark, and any third-party token layer follow along with no extra
     * work. Anchored near the top rather than dead centre, which is the idiom the
     * request named (Spotlight, Cmd+P).
     */
    const CSS = `
.dsp-scrim{position:fixed;inset:0;z-index:40;display:flex;align-items:flex-start;justify-content:center;padding:clamp(56px,14vh,160px) 24px 24px;background:var(--dsw-alias-bg-mask-1)}
.dsp-card{display:flex;flex-direction:column;width:min(920px,100%);max-height:min(560px,78vh);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.dsp-inputrow{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsp-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font-size:15px;line-height:22px}
.dsp-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsp-keyhint{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* Rename mode keeps the same field and the same line height, so nothing on the
   surface moves when ⌘⇧R is pressed; the accent is the whole mode indicator. */
.dsp-inputrow-renaming{border-bottom-color:var(--dsw-alias-state-business-primary)}
.dsp-keyhint-renaming{color:var(--dsw-alias-label-secondary)}
/* A rejected rename keeps the field open, so the reason needs a line of its own:
   the trailing chip is 11px and would ellipsize the one sentence that matters. */
.dsp-renameerror{padding:7px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
/* The header title editor: the same box as the shipped crumbCurrent span it
   covers (14px/20px, weight 500, 4px 8px padding), floated over it so the header
   does not reflow while the title is being typed. */
.dsp-title-edit{position:fixed;z-index:46;box-sizing:border-box;pointer-events:auto;margin:0;padding:0 8px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:20px;font-weight:500;outline:none;box-shadow:var(--dsw-elevation-prominent)}
.dsp-title-error{position:fixed;z-index:46;box-sizing:border-box;pointer-events:auto;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-elevation-prominent)}
.dsp-views{display:flex;align-items:center;gap:6px;padding:7px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsp-view{padding:2px 10px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;cursor:pointer}
.dsp-view:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-view[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsp-viewhint{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* A toast, not a banner: it lives in its own overlay-layer entry so it survives
   the palette closing, and it never reflows the list underneath. */
.dsp-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:45;display:flex;align-items:center;gap:12px;max-width:min(560px,90vw);padding:9px 10px 9px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dsp-toastmsg{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-toastbtn{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}
.dsp-toastbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-body{display:flex;flex:1;min-height:0}
.dsp-list{flex:1 1 58%;min-width:0;overflow:auto;padding:6px 6px 10px}
.dsp-pane{flex:1 1 42%;min-width:0;overflow:auto;border-left:1px solid var(--dsw-alias-border-l2);padding:14px 16px}
.dsp-group{margin:8px 0 2px;padding:0 10px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.dsp-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.dsp-row[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}
/* Not opacity: at .62 the tertiary subtitle measured ~2:1. A weaker label
   token dims the row while staying legible in every theme. */
.dsp-rowdim .dsp-rowtitle{color:var(--dsw-alias-label-secondary)}
.dsp-rowmain{flex:1;min-width:0}
.dsp-rowtitle{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:18px}
/* The title gives way, the tags never do: they are the thing being scanned. */
.dsp-rowtitletext{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-rowtitle .dsp-rowtags{margin-left:2px}
.dsp-rowsub{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsp-rowsub span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-mark{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsp-dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-idle-primary)}
.dsp-dot-on{background:var(--dsw-alias-state-business-primary)}
.dsp-dot-warn{background:var(--dsw-alias-state-warn-primary)}
/* A mode owns the field, so the mode says so on its own line: which session it is
   acting on, and how far along it is. Without this the field's border colour was
   the only signal that ⌘⇧R/⌘⇧T had changed what typing does. */
.dsp-modebar{display:flex;align-items:center;gap:8px;padding:6px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
.dsp-modebar strong{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsp-modebar-hint{margin-left:auto;color:var(--dsw-alias-label-tertiary)}
/* Tags. A chip is one control in both places it appears — beside a session and
   in the filter bar — so pressing it must mean the same thing in both: filter. */
.dsp-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
.dsp-chip{display:inline-flex;align-items:center;gap:4px;max-width:170px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:0 0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;cursor:pointer}
.dsp-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-chip[aria-pressed="true"]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsp-chipglyph{flex:none}
.dsp-chiplabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-chipcount{flex:none;color:var(--dsw-alias-label-tertiary)}
.dsp-filters{flex:none;display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.dsp-filtersempty{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
/* A row keeps its width: glyphs only, with the labels in the accessible name. */
.dsp-rowtags{flex:none;display:inline-flex;align-items:center;gap:3px;font-size:11px;line-height:16px}
/* While a mode owns the field the list is frozen, and says so with an accent on
   the row the mode is acting on instead of a second hover highlight. */
.dsp-row[data-dsp-target="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)}
.dsp-row[data-dsp-frozen="true"]{cursor:default}
.dsp-tagdot{width:6px;height:6px;border-radius:999px;flex:none}
.dsp-taglist{display:flex;flex-direction:column;gap:2px;margin-top:10px}
.dsp-tagrow{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer;font-size:13px;line-height:18px}
.dsp-tagrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-tagrow[data-dsp-tagactive="true"]{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsp-tagrow[aria-selected="true"] .dsp-tagcheck{color:var(--dsw-alias-label-primary)}
.dsp-tagcheck{flex:none;width:14px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.dsp-taglabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-tagmeta{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* The sidebar's own menu rows are the reference: same weight, same hover, so this
   entry does not look bolted on beside Pin/Rename/Fork/Archive. */
.dsp-menuitem{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;padding:6px 10px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsp-menuitem > svg{flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary))}
.dsp-menuitem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsp-panetitle{font-size:14px;font-weight:600;line-height:20px;word-break:break-word}
.dsp-panemeta{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dsp-badge{font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsp-hr{height:1px;margin:12px 0;background:var(--dsw-alias-border-l2)}
.dsp-turn{font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}
.dsp-turn+.dsp-turn{margin-top:10px}
.dsp-turnlabel{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);margin-bottom:3px}
.dsp-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsp-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:44px 16px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsp-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsp-footer span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-shimmer{height:12px;margin:8px 0;border-radius:4px;background:var(--dsw-alias-bg-skeleton);animation:dsp-pulse 1.4s ease-in-out infinite}
.dsp-shimmer-short{width:60%}
@keyframes dsp-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@media (max-width:700px){.dsp-pane{display:none}}
@media (max-width:520px){.dsp-scrim{padding:24px 12px}.dsp-card{max-height:min(70vh,520px)}}
@media (prefers-reduced-motion:reduce){.dsp-shimmer{animation:none}}
`

    //#endregion

    //#region components

    /** One status badge in the preview pane. */
    function Badge({ children }) {
      return h('span', { className: 'dsp-badge' }, children)
    }

    /** The small status mark at the trailing edge of a row. */
    function RowMark({ dotClass, label }) {
      return h(
        'span',
        { className: 'dsp-mark' },
        h('span', { className: `dsp-dot ${dotClass}` }),
        h('span', null, label),
      )
    }

    /**
     * The palette: nothing while closed, the dialog while open.
     *
     * `role="dialog"` plus `aria-modal="true"` is the host's contract for a modal
     * layer, not styling. Focus stays in the search input for the whole session
     * and the highlighted row is published with `aria-activedescendant`, so the
     * listbox never needs focus of its own.
     *
     * `palette` arrives from the registration's inject face and is a single
     * stable object, so it is safe to use as an effect dependency.
     */
    function PaletteEntry(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const palette = props.palette
      const state = useStore(palette.store)

      const sessionHook = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const statusHook =
        typeof props.useSessionStatus === 'function' ? props.useSessionStatus : () => undefined
      const workspaceHook =
        typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined

      const tags = state.tags ?? EMPTY_TAGS
      const list = sessionHook((snapshot) => snapshot)
      const statuses = statusHook((snapshot) => snapshot)
      const workspaces = workspaceHook((snapshot) => snapshot)

      const [query, setQuery] = React.useState('')
      const [view, setView] = React.useState('recents')
      const [manualActiveId, setManualActiveId] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())

      /**
       * The open rename editor, or null: `{ id, draft, busy, error }`.
       *
       * The editor reuses the search field instead of growing a second input. The
       * field is already focused and one line tall, so ⌘⇧R changes *what it edits*
       * without moving focus, resizing the card, or putting a text box inside a
       * `role="option"` row (an input nested in an option is invisible to the
       * accessibility tree). The query is kept, not cleared: you rename inside the
       * filtered list you were already looking at.
       */
      const [rename, setRename] = React.useState(null)

      /**
       * The open tag picker, or null: `{ draft, cursor }`.
       *
       * A mode of the same field, like rename, but it keeps the session list on
       * screen: the picker replaces the preview pane, so you can still see (and
       * click) which row you are tagging.
       */
      const [tagMode, setTagMode] = React.useState(null)

      /** Tag ids the list is filtered by; several mean "any of these". */
      const [tagFilter, setTagFilter] = React.useState([])

      const composingRef = React.useRef(false)

      const inputRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const listRef = React.useRef(null)
      const restoreRef = React.useRef(null)

      const open = state.open === true

      // Reset the transient view on every open. The epoch makes a re-open a fresh
      // view even though React kept the instance mounted.
      React.useEffect(() => {
        if (!open) return undefined
        setQuery('')
        setView('recents')
        setManualActiveId(null)
        // A rename or a tag picker that was open when the palette closed has no
        // target any more, and a filter is part of the view it was set in.
        setRename(null)
        setTagMode(null)
        setTagFilter([])
        // The toast outlives the palette by design, so the previous action's
        // message would otherwise still be sitting there on reopen.
        palette.dismissNotice()
        setNow(Date.now())
        restoreRef.current =
          typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        const frame = requestAnimationFrame(() => inputRef.current?.focus())
        return () => cancelAnimationFrame(frame)
      }, [open, state.epoch, palette])

      // A tag request arrives from the sidebar's menu row: open the palette with
      // that Session highlighted and the picker already up. Consumed on read, so
      // reopening with ⌘K later does not silently restore it.
      const tagRequest = state.tagRequest
      React.useEffect(() => {
        if (tagRequest === null || tagRequest === undefined || !open) return
        palette.clearTagRequest()
        setManualActiveId(tagRequest.id)
        setTagMode({ draft: '', cursor: 0 })
      }, [tagRequest, open, palette])

      // Escape closes only the foreground layer. The host's real arbiter is
      // `useModalLayer`, which owns its own layer stack — and this palette is NOT
      // registered in it, so `closeTopModal` can never close the palette. The
      // check below is therefore our own copy of the same *rule* (compare against
      // the document's last modalSelector match), which agrees with the host only
      // because every shipped modal is portalled to the body, making DOM order and
      // visual order coincide.
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape' || event.shiftKey) return
          if (event.ctrlKey || event.altKey || event.metaKey) return
          if (event.defaultPrevented) return
          const matches = document.querySelectorAll(MODAL_SELECTOR)
          if (matches.length === 0 || matches[matches.length - 1] !== cardRef.current) return
          event.preventDefault()
          if (!event.repeat) palette.close()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open, palette])

      // Hand focus back to whatever had it. Skipped when that node is gone, which
      // happens if the palette was opened over a transient surface.
      React.useEffect(() => {
        if (open) return undefined
        const previous = restoreRef.current
        restoreRef.current = null
        if (previous !== null && previous.isConnected === true) previous.focus()
        return undefined
      }, [open])

      const archivedIds = React.useMemo(() => {
        const ids = workspaces?.archivedSessionIds
        return new Set(Array.isArray(ids) ? ids : [])
      }, [workspaces])

      const pinnedIds = React.useMemo(() => {
        const ids = workspaces?.pinnedSessionIds
        return new Set(Array.isArray(ids) ? ids : [])
      }, [workspaces])

      // `pinnedSessionIds` is documented as pin order, most recently pinned
      // first, so the index doubles as the pinned group's sort key.
      const pinIndex = React.useMemo(() => {
        const ids = workspaces?.pinnedSessionIds
        const map = new Map()
        if (Array.isArray(ids)) ids.forEach((id, index) => map.set(id, index))
        return map
      }, [workspaces])

      const titles = React.useMemo(() => workspaceTitles(workspaces?.items), [workspaces])

      /** Vocabulary by id, for rendering a row's tags without a linear scan. */
      const tagIndex = React.useMemo(() => {
        const map = new Map()
        for (const tag of tags.vocabulary) map.set(tag.id, tag)
        return map
      }, [tags.vocabulary])

      const tagFilterSet = React.useMemo(() => new Set(tagFilter), [tagFilter])

      /**
       * The filtered, grouped view model.
       *
       * Membership comes from the session list, never from what happens to be
       * cached, so a session with no projections is still listed.
       */
      const model = React.useMemo(() => {
        const byId = list?.byId ?? {}
        const ids = Array.isArray(list?.ids) ? list.ids : []
        const needle = query.trim().toLowerCase()

        const decorated = []
        const archivedRows = []
        let archivedTotal = 0
        let pinnedTotal = 0
        let subagentHidden = 0
        let listed = 0

        for (const id of ids) {
          const row = byId[id]
          // `== null` on purpose: a null row would throw out of classify() and
          // take the whole slot entry down with it.
          if (row === undefined || row === null) continue
          const kind = classify(row, archivedIds.has(id))
          if (kind === 'subagent') {
            subagentHidden += 1
            continue
          }
          // A blank session is the provisional New Session row: no turns, no
          // title. Counted as neither listed nor hidden — it is a placeholder.
          if (kind === 'blank') continue
          const isArchived = kind === 'archived'
          if (isArchived) archivedTotal += 1
          else {
            listed += 1
            if (pinnedIds.has(id)) pinnedTotal += 1
          }

          const folder = folderLabel(row.cwd)
          const title =
            typeof row.displayTitle === 'string' && row.displayTitle !== ''
              ? row.displayTitle
              : folder !== ''
                ? folder
                : String(id)
          const workspace = titles.get(id) ?? folder
          let rank
          if (needle !== '') {
            // The directory, not just the workspace's display name: a workspace
            // can be renamed, and then its folder — the thing actually on disk —
            // becomes unsearchable. The full path is included for the same
            // reason a path-shaped query is the one people type ("test-dsh").
            // Titles still win: the ranker scores a match near the start of a
            // short string far above one buried in a long path.
            const path = typeof row.cwd === 'string' ? row.cwd : ''
            rank = rankCandidate([title, workspace, folder, path], needle)
            if (rank === undefined) continue
          }

          const status = statuses?.get?.(id)
          const pendingKind =
            status?.pendingInteraction?.kind !== undefined
              ? status.pendingInteraction.kind
              : undefined
          const running =
            status?.running === true ||
            (status?.running === undefined && row.running === true) ||
            runningChildCount(list, id, statuses) > 0
          const unread = status?.completionUnread === true

          const entry = {
            id: String(id),
            title,
            // The STORED title, not `displayTitle`: an untitled session falls back
            // to its folder or its id for display, and seeding the editor with that
            // fallback would quietly turn derived text into user data on save.
            storedTitle: typeof row.title === 'string' ? row.title : '',
            workspace,
            tagIds: Array.isArray(tags.assignments[id]) ? tags.assignments[id] : [],
            updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
            pendingLabel: pendingKind === undefined ? undefined : pendingKey(pendingKind),
            running: isArchived ? false : running,
            unread: isArchived ? false : unread,
            pinned: !isArchived && pinnedIds.has(id),
            pinIndex: pinIndex.get(id) ?? Number.MAX_SAFE_INTEGER,
            archived: isArchived,
            tier: isArchived ? 3 : tierOf(running, pendingKind, unread),
            rank,
          }
          if (isArchived) archivedRows.push(entry)
          else decorated.push(entry)
        }

        // Tag counts describe the list BEFORE the tag filter, so the bar keeps
        // saying "there are N sessions with this tag" while you are narrowing.
        const tagCounts = new Map()
        for (const row of decorated) {
          for (const tagId of row.tagIds) tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1)
        }

        // Applied on the way out rather than inside the loop, and to both drawers:
        // a filter has to mean the same thing in all three views.
        if (tagFilterSet.size > 0) {
          const keep = (row) => row.tagIds.some((tagId) => tagFilterSet.has(tagId))
          decorated.splice(0, decorated.length, ...decorated.filter(keep))
          archivedRows.splice(0, archivedRows.length, ...archivedRows.filter(keep))
        }

        // Each drawer's badge counts every live member, not just the ones the
        // query matches — so it keeps saying "there are N things in here" while
        // you type. `pinnedTotal` is counted in the loop above, before the query
        // filter; counting it here made the badge read 0 the moment a query
        // excluded the pinned rows, which is exactly when the reminder matters.
        const pinnedRows = decorated.filter((row) => row.pinned)

        // The drawers are views, not groups: a pin set months ago has nothing to
        // do with today, and an archived session is not part of the working set at
        // all. Neither may take space in the recency feed — that is the whole
        // reason separate views exist.
        if (view !== 'recents') {
          const matched = (
            view === 'pinned'
              ? pinnedRows.slice().sort((left, right) => comparePinned(left, right))
              : archivedRows.slice().sort((left, right) => compareByRecency(left, right))
          )
          const rows = matched.slice(0, ROW_LIMIT)
          return {
            groups: rows.length > 0 ? [{ key: view, heading: undefined, rows }] : [],
            rows,
            total: matched.length,
            tagCounts,
            pinnedTotal,
            archivedTotal,
            // Nothing is hidden while the view that holds it is open.
            subagentHidden,
            count: listed,
            truncated: matched.length > rows.length,
          }
        }

        decorated.sort((left, right) => compareRows(left, right, needle !== ''))

        const total = decorated.length
        const rows = decorated.slice(0, ROW_LIMIT)

        // With a query the list is one flat ranked block, because a query is
        // already a filter and buckets would only fragment the ranking. Without
        // one, the two activity groups lead the calendar buckets.
        const groups = []
        if (needle !== '') {
          if (rows.length > 0) groups.push({ key: 'results', heading: undefined, rows })
        } else {
          const push = (key, heading, predicate) => {
            const members = rows.filter(predicate)
            if (members.length > 0) groups.push({ key, heading, rows: members })
          }
          push('needsYou', t('group.needsYou'), (row) => row.tier === 0)
          push('active', t('group.active'), (row) => row.tier === 1 || row.tier === 2)
          const rest = rows.filter((row) => row.tier === 3)
          for (const [key, heading] of [
            ['today', t('group.today')],
            ['yesterday', t('group.yesterday')],
            ['week', t('group.week')],
            ['month', t('group.month')],
            ['older', t('group.older')],
          ]) {
            const members = rest.filter((row) => bucketOf(row.updatedAt, now) === key)
            if (members.length > 0) groups.push({ key, heading, rows: members })
          }
        }

        return {
          groups,
          rows,
          total,
          tagCounts,
          pinnedTotal,
          archivedTotal,
          subagentHidden,
          count: listed,
          truncated: total > rows.length,
        }
      }, [
        list,
        statuses,
        titles,
        archivedIds,
        pinnedIds,
        pinIndex,
        query,
        now,
        t,
        view,
        tags,
        tagFilterSet,
      ])

      // Keep the highlight valid as the list changes: the manual pick while it is
      // still present, otherwise the first row. Derived rather than stored, so
      // filtering can never leave the highlight on a row that is gone.
      const activeId = React.useMemo(() => {
        if (manualActiveId !== null && model.rows.some((row) => row.id === manualActiveId)) {
          return manualActiveId
        }
        return model.rows.length > 0 ? model.rows[0].id : null
      }, [manualActiveId, model])

      const activeRow = React.useMemo(
        () => model.rows.find((row) => row.id === activeId) ?? null,
        [model, activeId],
      )

      // `block: 'nearest'` is what keeps a keyboard walk from yanking the list
      // around when the target row is already visible.
      React.useEffect(() => {
        if (!open) return
        const container = listRef.current
        if (container === null) return
        const node = container.querySelector('[data-dsp-active="true"]')
        if (node !== null && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest' })
        }
      }, [activeId, open, model])

      /**
       * Switch between the recency feed and the pin drawer.
       *
       * The query survives the switch — a drawer has its own filter — and focus
       * returns to the input so typing continues to work after a click.
       */
      const pickView = React.useCallback((next) => {
        setView(next)
        setManualActiveId(null)
        inputRef.current?.focus()
      }, [])

      const move = React.useCallback(
        (delta) => {
          const rows = model.rows
          if (rows.length === 0) return
          const index = rows.findIndex((row) => row.id === activeId)
          const next = index === -1 ? 0 : (index + delta + rows.length) % rows.length
          setManualActiveId(rows[next].id)
        },
        [model, activeId],
      )

      const activate = React.useCallback(
        (row, isArchived) => {
          if (row === null) return
          // While tagging, a click retargets the picker: opening the session would
          // throw away the edit the click was meant to aim at.
          if (tagMode !== null) {
            setManualActiveId(row.id)
            inputRef.current?.focus()
            return
          }
          if (isArchived) {
            palette.notify(t('archived.open'))
            return
          }
          palette.openSession(row.id)
        },
        [palette, t, tagMode],
      )

      /**
       * The row the editor is renaming.
       *
       * Looked up by id rather than taken from the highlight: a rename that is in
       * flight outlives the render that started it, and the stored title it is
       * compared against must be the current one.
       */
      const renameRow = React.useMemo(
        () => (rename === null ? null : (model.rows.find((row) => row.id === rename.id) ?? null)),
        [model.rows, rename],
      )

      /**
       * Turn the search field into a title editor for the highlighted row.
       *
       * Seeds from the stored title — empty for a session that has never had one,
       * which the placeholder then explains. The seed is selected on the next
       * commit so the first keystroke replaces rather than appends.
       */
      const startRename = React.useCallback(() => {
        if (activeRow === null) return
        setRename({ id: activeRow.id, draft: activeRow.storedTitle, busy: false, error: null })
      }, [activeRow])

      const cancelRename = React.useCallback(() => {
        // An in-flight write is not abandoned: it already left, and dropping the
        // editor would hide a success the user cannot see happen.
        setRename((current) => (current === null || current.busy ? current : null))
      }, [])

      const commitRename = React.useCallback(() => {
        if (rename === null || rename.busy) return
        const draft = rename.draft.trim()
        // The host normalizes and then refuses a title with no visible characters
        // ("must contain visible characters"), so an empty draft is not a request
        // worth retaining the session for.
        if (draft === '') return
        const previous = renameRow === null ? '' : renameRow.storedTitle
        // Nothing to write. Closing is the honest outcome, and it costs no retain.
        if (draft === previous.trim()) {
          cancelRename()
          return
        }
        setRename((current) =>
          current === null ? current : { ...current, busy: true, error: null },
        )
        palette.rename(rename.id, draft, previous).then(
          () => setRename(null),
          (error) => {
            setRename((current) =>
              current === null
                ? current
                : {
                    ...current,
                    busy: false,
                    error: error instanceof Error ? error.message : String(error),
                  },
            )
          },
        )
      }, [rename, renameRow, palette, cancelRename])

      /**
       * Open the tag picker on the highlighted row.
       *
       * Entering is allowed even when the Host cannot store tags yet: the picker
       * then explains that instead of doing nothing, which is the difference
       * between a feature that is not ready and one that appears broken.
       */
      const enterTagMode = React.useCallback(() => {
        if (activeRow === null) return
        setTagMode({ draft: '', cursor: 0 })
      }, [activeRow])

      const exitTagMode = React.useCallback(() => {
        setTagMode(null)
      }, [])

      /**
       * What Enter would act on, in order.
       *
       * The create row leads only when the draft names no existing tag, so typing
       * the exact label of a tag you already have toggles it instead of creating a
       * near-duplicate.
       */
      const tagDraft = tagMode === null ? '' : tagMode.draft
      const tagOptions = React.useMemo(() => {
        if (tagMode === null) return []
        const needle = tagDraft.trim().toLowerCase()
        const options = []
        const exact = tags.vocabulary.some((tag) => tag.label.toLowerCase() === needle)
        if (needle !== '' && !exact) options.push({ kind: 'create', label: tagDraft.trim() })
        for (const tag of tags.vocabulary) {
          if (needle !== '' && !tag.label.toLowerCase().includes(needle)) continue
          options.push({ kind: 'tag', tag })
        }
        return options
      }, [tagMode, tagDraft, tags.vocabulary])

      const tagCursor =
        tagMode === null ? 0 : Math.min(tagMode.cursor, Math.max(0, tagOptions.length - 1))

      const moveTagCursor = React.useCallback(
        (delta) => {
          const count = tagOptions.length
          if (count === 0) return
          setTagMode((current) => {
            if (current === null) return current
            const index = Math.min(current.cursor, count - 1)
            return { ...current, cursor: (index + delta + count) % count }
          })
        },
        [tagOptions.length],
      )

      const applyTagOption = React.useCallback(
        (option) => {
          if (option === undefined || option === null || activeRow === null) return
          if (option.kind === 'create') {
            palette.createTag(option.label, activeRow.id)
            // Clearing the draft is what makes the new tag immediately visible as a
            // ticked row, rather than leaving the text that created it.
            setTagMode({ draft: '', cursor: 0 })
            return
          }
          palette.toggleTag(activeRow.id, option.tag.id)
        },
        [activeRow, palette],
      )

      const pickTag = React.useCallback(() => {
        // Pressing Enter in a picker that cannot save says why, rather than doing
        // nothing: the pane already explains it, and this is the same answer for
        // someone who is typing rather than reading.
        if (tags.ready !== true) {
          palette.notify(t('tags.notReady'))
          return
        }
        applyTagOption(tagOptions[tagCursor])
      }, [applyTagOption, tagOptions, tagCursor, tags.ready, palette, t])

      /** Filter means "any of these", which is how tags are used in practice. */
      const toggleTagFilter = React.useCallback((tagId) => {
        setTagFilter((current) =>
          current.includes(tagId)
            ? current.filter((id) => id !== tagId)
            : [...current, tagId],
        )
        inputRef.current?.focus()
      }, [])

      const onKeyDown = React.useCallback(
        (event) => {
          if (tagMode !== null) {
            // The chord that opened the picker closes it, so the gesture is a
            // toggle in both directions.
            if (
              (event.key === 't' || event.key === 'T') &&
              event.shiftKey &&
              (event.metaKey || event.ctrlKey) &&
              !event.altKey
            ) {
              event.preventDefault()
              exitTagMode()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              exitTagMode()
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              moveTagCursor(event.key === 'ArrowDown' ? 1 : -1)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (!composingRef.current && event.nativeEvent?.isComposing !== true) pickTag()
              return
            }
            // Tab, Home and End stay the text field's: the picker has no ring of
            // its own to cycle.
            return
          }
          if (rename !== null) {
            // The editor owns the field while it is open. Tab, the arrows, Home
            // and End are text editing again, and the list must not move under
            // the row being renamed.
            if (event.key === 'Enter') {
              event.preventDefault()
              // An IME candidate is confirmed with Enter; committing there would
              // save half a word. `nativeEvent` is absent in the test harness, so
              // the composition ref is the load-bearing half.
              if (!composingRef.current && event.nativeEvent?.isComposing !== true) commitRename()
              return
            }
            if (event.key === 'Escape') {
              // Both halves: the document-level Escape arbiter returns early on a
              // prevented event, and stopping the bubble keeps it from reaching
              // that listener at all.
              event.preventDefault()
              event.stopPropagation()
              cancelRename()
            }
            return
          }
          if (event.key === 'Tab') {
            // Tab is genuinely free here: Enter is the only "open" gesture, so
            // accepting on Tab — the convention in the host's own `/` menu, where
            // Tab commits a value — would be redundant. Intercepting it also
            // keeps focus inside the dialog, which the palette does not
            // otherwise trap.
            event.preventDefault()
            const step = event.shiftKey ? -1 : 1
            const index = VIEWS.indexOf(view)
            pickView(VIEWS[(index + step + VIEWS.length) % VIEWS.length])
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
            return
          }
          if (event.key === 'Home') {
            // The first press belongs to the text field: only jump the list once
            // the caret is already at the start.
            const field = event.target
            if (field !== null && field.selectionStart !== undefined && field.selectionStart !== 0) return
            event.preventDefault()
            if (model.rows.length > 0) setManualActiveId(model.rows[0].id)
            return
          }
          if (event.key === 'End') {
            const field = event.target
            if (
              field !== null &&
              field.selectionEnd !== undefined &&
              field.selectionEnd !== field.value.length
            ) {
              return
            }
            event.preventDefault()
            if (model.rows.length > 0) setManualActiveId(model.rows[model.rows.length - 1].id)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (activeRow !== null) activate(activeRow, archivedIds.has(activeRow.id))
            return
          }
          if (
            // NOT ⌘⇧⌫: that is the host's own `session.archive`, which Electron
            // intercepts natively before the page sees it, so this handler would
            // never run and the host would archive the session behind the
            // palette instead. Backspace is a reserved key, so no command can
            // ever own ⌘⇧⌫ and it is structurally guaranteed to reach us.
            event.key === 'Backspace' &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey
          ) {
            event.preventDefault()
            if (activeRow !== null) {
              palette.archiveRow(activeRow.id, archivedIds.has(activeRow.id))
            }
            return
          }
          if (
            (event.key === 'p' || event.key === 'P') &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey
          ) {
            event.preventDefault()
            if (activeRow !== null) {
              // Pin and archive are mutually exclusive upstream, so offering pin
              // on an archived row is a dead action the user cannot see fail.
              if (activeRow.archived) palette.notify(t('pin.archived'))
              else palette.togglePin(activeRow.id, activeRow.pinned)
            }
            return
          }
          if (
            // ⌘⇧T: unclaimed, like ⌘⇧R. ⌘T is the browser panel.
            (event.key === 't' || event.key === 'T') &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey
          ) {
            event.preventDefault()
            enterTagMode()
            return
          }
          if (
            // ⌘⇧R, not ⌘R: `page.refresh` owns ⌘R (and owns it natively — Electron
            // intercepts the chord before the page sees it), and not ⌘⌥G, which is
            // the host's own `session.rename` with the same fate. R for rename,
            // shift as its variant; no shipped command claims the combination.
            (event.key === 'r' || event.key === 'R') &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey) &&
            !event.altKey
          ) {
            event.preventDefault()
            startRename()
          }
        },
        [
          move,
          model,
          activate,
          activeRow,
          archivedIds,
          palette,
          pickView,
          view,
          rename,
          commitRename,
          cancelRename,
          startRename,
          tagMode,
          tagOptions,
          enterTagMode,
          exitTagMode,
          moveTagCursor,
          pickTag,
          applyTagOption,
        ],
      )

      // Seed the editor selected, so the first keystroke replaces the old title
      // instead of appending to it. Keyed on the target, not on the draft.
      const renameTargetId = rename === null ? null : rename.id
      React.useEffect(() => {
        if (renameTargetId === null) return
        inputRef.current?.select?.()
      }, [renameTargetId])

      // The outline, and the reason the dwell timer exists: projections cover
      // roughly two thirds of the list, and the missing third is the old sessions
      // a palette is most useful for.
      const outline = React.useMemo(() => {
        if (activeId === null) return null
        const fromRow = list?.byId?.[activeId]?.projectionValues?.turnOutline
        if (Array.isArray(fromRow) && fromRow.length > 0) return fromRow
        const fromProjections = list?.projectionsBySession?.[activeId]?.values?.turnOutline
        if (Array.isArray(fromProjections) && fromProjections.length > 0) return fromProjections
        return null
      }, [list, activeId])

      React.useEffect(() => {
        if (!open || activeId === null || outline !== null) return undefined
        palette.ensureProjections(activeId)
        return () => palette.cancelProjections()
      }, [open, activeId, outline, palette])

      if (!open) return null

      const lastTurn =
        outline === null || outline.length === 0 ? null : outline[outline.length - 1]
      // Only a LACK of data justifies a placeholder. Testing `pendingId` alone
      // meant any in-flight refresh hid the turn text already on screen — and
      // with no timeout anywhere, a refresh that never settled hid it forever.
      const pendingOutline =
        state.pendingId !== null && state.pendingId === activeId && outline === null
      const exhausted = !pendingOutline && state.triedId === activeId

      // One field, three jobs. Rename and tag are exclusive: both are entered from
      // the list and exited with Escape, so only one can own the field.
      const mode = rename !== null ? 'rename' : tagMode !== null ? 'tag' : 'search'

      /** The label list for a row's glyph strip, used as its accessible name. */
      const tagLabelsOf = (ids) =>
        ids
          .map((id) => tagIndex.get(id)?.label)
          .filter((label) => typeof label === 'string' && label !== '')
          .join(' · ')

      /**
       * One tag chip.
       *
       * The same control in the filter bar and in the preview, because pressing a
       * tag must mean the same thing wherever it appears: filter. Inside the picker
       * it is display-only (`display: true`), since there the tag list is already
       * the toggle surface and a second meaning would be a second mental model.
       */
      const tagChip = (tag, options = {}) =>
        h(
          options.display === true ? 'span' : 'button',
          {
            key: tag.id,
            ...(options.display === true
              ? { className: 'dsp-chip' }
              : {
                  type: 'button',
                  tabIndex: -1,
                  className: 'dsp-chip',
                  'aria-pressed': tagFilterSet.has(tag.id) ? 'true' : 'false',
                  title: tag.label,
                  onClick: () => toggleTagFilter(tag.id),
                }),
          },
          tag.emoji !== ''
            ? h('span', { className: 'dsp-chipglyph' }, tag.emoji)
            : h('span', {
                className: 'dsp-tagdot',
                style: { background: TAG_COLOR_TOKEN[tag.color] ?? TAG_COLOR_TOKEN.gray },
              }),
          h('span', { className: 'dsp-chiplabel' }, tag.label),
          options.count === undefined
            ? null
            : h('span', { className: 'dsp-chipcount' }, t('tags.count', { n: options.count })),
        )

      const rowNodes = []
      for (const group of model.groups) {
        if (group.heading !== undefined) {
          rowNodes.push(h('div', { key: `g:${group.key}`, className: 'dsp-group' }, group.heading))
        }
        for (const row of group.rows) {
          const selected = row.id === activeId
          const optionId = `dsp-opt-${domSafe(row.id)}`
          rowNodes.push(
            h(
              'div',
              {
                key: row.id,
                id: optionId,
                className: row.archived ? 'dsp-row dsp-rowdim' : 'dsp-row',
                role: 'option',
                'aria-selected': selected ? 'true' : 'false',
                'data-dsp-active': selected ? 'true' : undefined,
                // A mode owns the field and its target: the list must not move under
                // it, or the answer to "which session am I editing" changes silently.
                'data-dsp-target': mode !== 'search' && selected ? 'true' : undefined,
                'data-dsp-frozen': mode === 'search' ? undefined : 'true',
                // Without this the click moves focus to <body>, after which no
                // keydown passes through the card and every shortcut dies — on a
                // path (an archived row) that deliberately keeps the palette open.
                onMouseDown: (event) => event.preventDefault(),
                onMouseEnter: () => {
                  if (mode !== 'search') return
                  setManualActiveId(row.id)
                },
                onClick: () => {
                  if (mode !== 'search') return
                  activate(row, archivedIds.has(row.id))
                },
              },
              h(
                'div',
                { className: 'dsp-rowmain' },
                h(
                  'div',
                  { className: 'dsp-rowtitle' },
                  h('span', { className: 'dsp-rowtitletext' }, row.title),
                  // Right after the title, where scanning happens — the trailing
                  // edge already carries the status mark.
                  row.tagIds.length === 0
                    ? null
                    : h(
                        'span',
                        {
                          className: 'dsp-rowtags',
                          title: tagLabelsOf(row.tagIds),
                          'aria-label': tagLabelsOf(row.tagIds),
                        },
                        row.tagIds.map((tagId) => {
                          const tag = tagIndex.get(tagId)
                          if (tag === undefined) return null
                          return tag.emoji !== ''
                            ? h('span', { key: tagId, className: 'dsp-chipglyph' }, tag.emoji)
                            : h('span', {
                                key: tagId,
                                className: 'dsp-tagdot',
                                style: {
                                  background: TAG_COLOR_TOKEN[tag.color] ?? TAG_COLOR_TOKEN.gray,
                                },
                              })
                        }),
                      ),
                ),
                h(
                  'div',
                  { className: 'dsp-rowsub' },
                  h('span', null, row.workspace === '' ? '—' : row.workspace),
                  h('span', null, '·'),
                  h('span', null, agoText(t, row.updatedAt, now)),
                ),
              ),
              row.tier === 0
                ? h(RowMark, { dotClass: 'dsp-dot-warn', label: t(row.pendingLabel) })
                : row.tier === 1
                  ? h(RowMark, { dotClass: 'dsp-dot-on', label: t('status.running') })
                  : row.tier === 2
                    ? h(RowMark, { dotClass: 'dsp-dot', label: t('status.unread') })
                    : null,
            ),
          )
        }
      }

      let preview
      if (activeRow === null) {
        preview = h('div', { className: 'dsp-empty' }, t('palette.empty'))
      } else {
        const parts = [
          h('div', { key: 'title', className: 'dsp-panetitle' }, activeRow.title),
          h(
            'div',
            { key: 'meta', className: 'dsp-panemeta' },
            `${activeRow.workspace === '' ? '—' : activeRow.workspace} · ${
              // "You last spoke now ago" is not a sentence; the just-now case
              // needs its own phrasing in both languages.
              agoParts(activeRow.updatedAt, now).key === 'ago.now'
                ? t('preview.youNow')
                : t('preview.you', { ago: agoText(t, activeRow.updatedAt, now) })
            }`,
          ),
        ]

        const badges = []
        if (activeRow.pendingLabel !== undefined) {
          badges.push(h(Badge, { key: 'pending' }, t(activeRow.pendingLabel)))
        }
        if (activeRow.running) badges.push(h(Badge, { key: 'running' }, t('status.running')))
        if (activeRow.unread) badges.push(h(Badge, { key: 'unread' }, t('status.unread')))
        if (activeRow.pinned) badges.push(h(Badge, { key: 'pinned' }, t('status.pinned')))
        if (activeRow.archived) badges.push(h(Badge, { key: 'archived' }, t('status.archived')))
        if (badges.length > 0) parts.push(h('div', { key: 'badges', className: 'dsp-badges' }, badges))

        const sessionTags = activeRow.tagIds
          .map((tagId) => tagIndex.get(tagId))
          .filter((tag) => tag !== undefined)
        if (sessionTags.length > 0) {
          parts.push(
            h('div', { key: 'tags', className: 'dsp-chips' }, sessionTags.map((tag) => tagChip(tag))),
          )
        }

        parts.push(h('div', { key: 'hr', className: 'dsp-hr' }))

        if (pendingOutline) {
          parts.push(
            h('div', { key: 'load', className: 'dsp-note' }, t('preview.loading')),
            h('div', { key: 's1', className: 'dsp-shimmer' }),
            h('div', { key: 's2', className: 'dsp-shimmer dsp-shimmer-short' }),
          )
        } else if (lastTurn === null) {
          parts.push(
            h(
              'div',
              { key: 'none', className: 'dsp-note' },
              activeRow.archived
                ? t('archived.restoreHint')
                : exhausted
                  ? t('preview.unavailable')
                  : t('preview.none'),
            ),
          )
        } else {
          if (lastTurn.prompt !== '') {
            parts.push(
              h(
                'div',
                { key: 'prompt', className: 'dsp-turn' },
                h('div', { className: 'dsp-turnlabel' }, t('preview.prompt')),
                lastTurn.prompt,
              ),
            )
          }
          if (lastTurn.response !== '') {
            parts.push(
              h(
                'div',
                { key: 'response', className: 'dsp-turn' },
                h('div', { className: 'dsp-turnlabel' }, t('preview.response')),
                lastTurn.response,
              ),
            )
          }
          if (lastTurn.prompt === '' && lastTurn.response === '') {
            parts.push(h('div', { key: 'empty', className: 'dsp-note' }, t('preview.unavailable')))
          }
        }

        preview = h(React.Fragment, null, parts)
      }

      const blankQuery = query.trim() === ''
      const emptyState =
        view === 'pinned'
          ? {
              title: blankQuery ? t('pinned.empty') : t('pinned.emptyMatch'),
              hint: t('pinned.emptyHint'),
            }
          : view === 'archived'
            ? {
                title: blankQuery ? t('archived.empty') : t('archived.emptyMatch'),
                hint: t('archived.emptyHint'),
              }
            : {
                title: blankQuery ? t('palette.none') : t('palette.empty'),
                hint: blankQuery ? undefined : t('palette.emptyHint'),
              }

      // The picker takes the preview pane rather than the list: the row being
      // tagged has to stay visible while you choose, and the list's own keyboard
      // handling keeps working for retargeting.
      let picker = null
      if (tagMode !== null && activeRow !== null) {
        const options = tagOptions.map((option, index) => {
          const tag = option.kind === 'tag' ? option.tag : null
          const assigned = tag !== null && activeRow.tagIds.includes(tag.id)
          return h(
            'div',
            {
              key: tag === null ? 'create' : tag.id,
              id: `dsp-tagopt-${index}`,
              className: 'dsp-tagrow',
              role: 'option',
              'aria-selected': assigned ? 'true' : 'false',
              'data-dsp-tagactive': index === tagCursor ? 'true' : undefined,
              // Keeps focus in the field, so ↑↓ and typing still work after a click.
              onMouseDown: (event) => {
                event.preventDefault()
                setTagMode((current) =>
                  current === null ? current : { ...current, cursor: index },
                )
              },
              onClick: () => applyTagOption(option),
            },
            h('span', { className: 'dsp-tagcheck' }, tag === null ? '＋' : assigned ? '✓' : ''),
            tag === null || tag.emoji === ''
              ? tag === null
                ? null
                : h('span', {
                    className: 'dsp-tagdot',
                    style: {
                      background: TAG_COLOR_TOKEN[tag.color] ?? TAG_COLOR_TOKEN.gray,
                    },
                  })
              : h('span', { className: 'dsp-chipglyph' }, tag.emoji),
            h(
              'span',
              { className: 'dsp-taglabel' },
              tag === null ? t('tags.create', { label: option.label }) : tag.label,
            ),
            h(
              'span',
              { className: 'dsp-tagmeta' },
              tag === null ? '' : t('tags.count', { n: model.tagCounts.get(tag.id) ?? 0 }),
            ),
          )
        })
        picker = h(
          React.Fragment,
          null,
          h('div', { key: 'title', className: 'dsp-panetitle' }, activeRow.title),
          h(
            'div',
            { key: 'meta', className: 'dsp-panemeta' },
            tags.ready ? t('tags.hint') : t('tags.notReadyHint'),
          ),
          // What this session already carries, so tagging never hides the state it
          // is editing. Display chips, not the filter control: the list below is the
          // only toggle surface in this mode.
          h(
            'div',
            { key: 'chips', className: 'dsp-chips' },
            activeRow.tagIds
              .map((tagId) => tagIndex.get(tagId))
              .filter((tag) => tag !== undefined)
              .map((tag) => tagChip(tag, { display: true })),
            h(
              'span',
              { className: 'dsp-tagmeta' },
              t('tags.count', { n: activeRow.tagIds.length }),
            ),
          ),
          !tags.ready
            ? h('div', { key: 'notready', className: 'dsp-note', role: 'status' }, t('tags.notReady'))
            : null,
          h(
            'div',
            {
              key: 'list',
              className: 'dsp-taglist',
              id: 'dsp-taglistbox',
              role: 'listbox',
              'aria-label': t('tags.aria'),
            },
            options.length > 0
              ? options
              : h('div', { className: 'dsp-note' }, tags.ready ? t('tags.empty') : ''),
          ),
        )
      }

      const footerLeft = [
        t('palette.count', { n: model.count }),
        model.subagentHidden > 0
          ? t('palette.subagentHidden', { n: model.subagentHidden })
          : null,
        model.truncated
          ? t('palette.truncated', { shown: model.rows.length, total: model.total })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')

      return h(
        'div',
        {
          className: 'dsp-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) palette.close()
          },
        },
        h(
          'div',
          {
            ref: cardRef,
            className: 'dsp-card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('palette.aria'),
            'data-shortcut-modal': ROW_ID,
            onKeyDown,
          },
          h(
            'div',
            {
              className:
                mode === 'search' ? 'dsp-inputrow' : 'dsp-inputrow dsp-inputrow-renaming',
            },
            h('input', {
              ref: inputRef,
              className: 'dsp-input',
              type: 'text',
              // One field, three jobs, and the ARIA role follows the job: a plain
              // text box while renaming (no list is driven), a combobox over the
              // session list while searching, and a combobox over the tag list
              // while picking.
              role: mode === 'rename' ? 'textbox' : 'combobox',
              'aria-label':
                mode === 'rename' ? t('rename.aria') : mode === 'tag' ? t('tags.aria') : undefined,
              ...(mode === 'search'
                ? {
                    'aria-expanded': 'true',
                    'aria-controls': 'dsp-listbox',
                    'aria-activedescendant':
                      activeId === null ? undefined : `dsp-opt-${domSafe(activeId)}`,
                    'aria-autocomplete': 'list',
                  }
                : mode === 'tag'
                  ? {
                      'aria-expanded': 'true',
                      'aria-controls': 'dsp-taglistbox',
                      'aria-activedescendant':
                        tagOptions.length === 0 ? undefined : `dsp-tagopt-${tagCursor}`,
                      'aria-autocomplete': 'list',
                    }
                  : rename.busy
                    ? { 'aria-busy': 'true' }
                    : {}),
              // Not `disabled`: a disabled field loses focus, and the editor has to
              // stay focused through an in-flight write.
              readOnly: rename !== null && rename.busy,
              placeholder:
                mode === 'search'
                  ? t('palette.placeholder')
                  : mode === 'rename'
                    ? t('rename.placeholder')
                    : t('tags.emptyHint'),
              value: mode === 'search' ? query : mode === 'rename' ? rename.draft : tagDraft,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => {
                const value = event.target.value
                if (mode === 'search') setQuery(value)
                else if (mode === 'tag') {
                  setTagMode((current) => (current === null ? current : { ...current, draft: value, cursor: 0 }))
                }
                // Typing clears the last failure: the message describes the draft
                // that was submitted, not the one being typed.
                else
                  setRename((current) =>
                    current === null ? current : { ...current, draft: value, error: null },
                  )
              },
              onCompositionStart: () => {
                composingRef.current = true
              },
              onCompositionEnd: () => {
                composingRef.current = false
              },
            }),
            h(
              'span',
              { className: mode === 'search' ? 'dsp-keyhint' : 'dsp-keyhint dsp-keyhint-renaming' },
              mode === 'search'
                ? (state.hotkeyLabel ?? '')
                : mode === 'rename'
                  ? t('rename.hint')
                  : t('tags.hint'),
            ),
          ),
          // A mode owns the field, so it says which session it is acting on and
          // that the list is frozen. Without this the only signal was the field's
          // border colour, which left "did ⌘⇧T take?" and "which row am I editing?"
          // to be guessed.
          mode === 'search'
            ? null
            : h(
                'div',
                { className: 'dsp-modebar', role: 'status' },
                h(
                  'span',
                  null,
                  mode === 'rename'
                    ? t('rename.bar', { title: activeRow === null ? '' : activeRow.title })
                    : t('tags.bar', {
                        title: activeRow === null ? '' : activeRow.title,
                        n: activeRow === null ? 0 : activeRow.tagIds.length,
                      }),
                ),
                h('span', { className: 'dsp-modebar-hint' }, t('mode.locked')),
              ),
          // A rejected write leaves the field in rename mode with its draft intact,
          // so the reason gets its own line: retyping and pressing Enter again is
          // the whole recovery path.
          rename !== null && rename.error !== null
            ? h('div', { className: 'dsp-renameerror', role: 'alert' }, rename.error)
            : null,
          // A visible switch, not just a hidden Tab binding: the count is the
          // reminder that the drawer has something in it, and a mouse user can
          // reach the drawer without learning the chord.
          h(
            'div',
            { className: 'dsp-views' },
            h(
              'button',
              {
                type: 'button',
                tabIndex: -1,
                className: 'dsp-view',
                'aria-pressed': view === 'recents' ? 'true' : 'false',
                onClick: () => pickView('recents'),
              },
              t('view.recents'),
            ),
            h(
              'button',
              {
                type: 'button',
                tabIndex: -1,
                className: 'dsp-view',
                'aria-pressed': view === 'pinned' ? 'true' : 'false',
                onClick: () => pickView('pinned'),
              },
              t('view.pinned', { n: model.pinnedTotal }),
            ),
            h(
              'button',
              {
                type: 'button',
                tabIndex: -1,
                className: 'dsp-view',
                'aria-pressed': view === 'archived' ? 'true' : 'false',
                onClick: () => pickView('archived'),
              },
              t('view.archived', { n: model.archivedTotal }),
            ),
            h('span', { className: 'dsp-viewhint' }, t('view.hint')),
          ),
          // The filter bar only lists tags that are actually in use, plus any that
          // are selected — a vocabulary you have not applied yet is not a filter.
          tags.vocabulary.length > 0
            ? h(
                'div',
                { className: 'dsp-filters', role: 'group', 'aria-label': t('tags.aria') },
                tags.vocabulary
                  .filter(
                    (tag) => (model.tagCounts.get(tag.id) ?? 0) > 0 || tagFilterSet.has(tag.id),
                  )
                  .map((tag) => tagChip(tag, { count: model.tagCounts.get(tag.id) ?? 0 })),
                tagFilterSet.size > 0
                  ? h(
                      'button',
                      {
                        type: 'button',
                        tabIndex: -1,
                        className: 'dsp-chip',
                        onClick: () => {
                          setTagFilter([])
                          inputRef.current?.focus()
                        },
                      },
                      t('tags.clear'),
                    )
                  : null,
              )
            : null,
          h(
            'div',
            { className: 'dsp-body' },
            h(
              'div',
              {
                ref: listRef,
                className: 'dsp-list',
                id: 'dsp-listbox',
                role: 'listbox',
                'aria-label': t('palette.aria'),
              },
              rowNodes.length === 0
                ? h(
                    'div',
                    { className: 'dsp-empty' },
                    emptyState.title,
                    emptyState.hint === undefined ? null : h('span', null, emptyState.hint),
                  )
                : rowNodes,
            ),
            h('div', { className: 'dsp-pane' }, picker === null ? preview : picker),
          ),
          h(
            'div',
            { className: 'dsp-footer' },
            h('span', null, footerLeft),
            h('span', null, t('preview.footer')),
          ),
        ),
      )
    }

    /**
     * The action toast.
     *
     * Registered as its own `shell.overlay` entry rather than drawn inside the
     * palette, for three reasons the inline version got wrong: it must outlive
     * the palette, it must not reflow the list when it appears, and feedback
     * belongs near the action's *result* rather than inside the surface that was
     * dismissed by it. `role="status"` makes it polite for assistive tech, and
     * Undo is what turns a transient message into something useful.
     */
    function NoticeToast(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const palette = props.palette
      const state = useStore(palette.store)
      const notice = state.notice
      if (notice === null || notice === undefined) return null
      return h(
        'div',
        { className: 'dsp-toast', role: 'status' },
        h('span', { className: 'dsp-toastmsg' }, notice.text),
        notice.undo === undefined || notice.undo === null
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'dsp-toastbtn',
                onClick: () => {
                  palette.dismissNotice()
                  notice.undo()
                },
              },
              t('notice.undo'),
            ),
      )
    }

    //#endregion

    //#region header title

    /**
     * The conversation header's title, renamed in place by a double click.
     *
     * A floating editor rather than a slot contribution, and that is the whole
     * design decision. The shipped header draws its own title span and puts no
     * slot over it; the neighbouring seats are the action chips
     * (`conversation.session.header.actions`) and the crumb replacement
     * (`…header.lineage`, which also renders the titles of *subagent* ancestors —
     * taking it over would mean re-implementing their styling). So the choice is
     * between floating an input over the title or not being in place at all: this
     * takes the span's own box, which is why it opens exactly where the text was,
     * while the header keeps its layout.
     *
     * Everything after the box is shared with the palette: the same write path,
     * the same toast with Undo, the same rule that a blank draft is never sent.
     */
    function HeaderTitleEditor(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const palette = props.palette
      const [editor, setEditor] = React.useState(null)
      const fieldRef = React.useRef(null)
      const composingRef = React.useRef(false)
      const openSeq = React.useRef(0)

      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
          return undefined
        }
        const onDoubleClick = (event) => {
          const node = event.target
          const span =
            node !== null && node !== undefined && typeof node.closest === 'function'
              ? node.closest(TITLE_SELECTOR)
              : null
          // Not the header title: the sidebar's own rows have a double click
          // already (the host's rename dialog), and adding a second one here
          // would race it.
          if (span === null) return
          const current = palette.currentSession()
          if (current === null) return
          const rect =
            typeof span.getBoundingClientRect === 'function' ? span.getBoundingClientRect() : null
          if (rect === null) return
          event.preventDefault()
          openSeq.current += 1
          setEditor({
            id: current.id,
            seed: current.title,
            draft: current.title,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            nonce: openSeq.current,
            busy: false,
            error: null,
          })
        }
        document.addEventListener('dblclick', onDoubleClick)
        return () => document.removeEventListener('dblclick', onDoubleClick)
      }, [palette])

      // Seed the field selected, so the first keystroke replaces the old title
      // instead of appending to it — the same promise the palette's editor makes.
      const nonce = editor === null ? null : editor.nonce
      React.useEffect(() => {
        if (nonce === null) return
        fieldRef.current?.focus?.()
        fieldRef.current?.select?.()
      }, [nonce])

      const close = React.useCallback(() => {
        // An in-flight write is not abandoned: it already left, and closing would
        // hide a success the user cannot see happen.
        setEditor((current) => (current === null || current.busy ? current : null))
      }, [])

      const commit = React.useCallback(() => {
        if (editor === null || editor.busy) return
        const draft = editor.draft.trim()
        // The host refuses a title with no visible characters; asking anyway
        // would cost a retain to learn that.
        if (draft === '') return
        if (draft === editor.seed.trim()) {
          setEditor(null)
          return
        }
        setEditor((current) => (current === null ? current : { ...current, busy: true, error: null }))
        palette.rename(editor.id, draft, editor.seed).then(
          () => setEditor(null),
          (error) => {
            setEditor((current) =>
              current === null
                ? current
                : {
                    ...current,
                    busy: false,
                    error: error instanceof Error ? error.message : String(error),
                  },
            )
          },
        )
      }, [editor, palette])

      if (editor === null) return null

      const width = Math.max(editor.width, 260)
      const viewport =
        typeof window !== 'undefined' && typeof window.innerWidth === 'number'
          ? window.innerWidth - editor.left - 12
          : 0
      const left = `${Math.round(editor.left)}px`
      const top = `${Math.round(editor.top)}px`
      const box = {
        left,
        top,
        width: `${Math.round(viewport > 120 ? Math.min(width, viewport) : width)}px`,
        height: `${Math.round(editor.height)}px`,
      }
      return h(
        React.Fragment,
        null,
        h('input', {
          ref: fieldRef,
          className: 'dsp-title-edit',
          style: box,
          type: 'text',
          value: editor.draft,
          // Not `disabled`: a disabled field loses focus mid-write.
          readOnly: editor.busy,
          'aria-label': t('rename.aria'),
          'aria-busy': editor.busy ? 'true' : undefined,
          placeholder: t('rename.placeholder'),
          spellCheck: false,
          autoComplete: 'off',
          onChange: (event) => {
            const value = event.target.value
            // Typing clears the last failure: it described the draft that was
            // submitted, not the one being typed.
            setEditor((current) =>
              current === null ? current : { ...current, draft: value, error: null },
            )
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              // An IME candidate is confirmed with Enter.
              if (!composingRef.current && event.nativeEvent?.isComposing !== true) commit()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
          },
          // Clicking anywhere else means "not now" — the same rule Finder's
          // inline rename follows, and it never writes by accident.
          onBlur: () => close(),
          onCompositionStart: () => {
            composingRef.current = true
          },
          onCompositionEnd: () => {
            composingRef.current = false
          },
        }),
        editor.error === null || editor.error === undefined
          ? null
          : h(
              'div',
              {
                className: 'dsp-title-error',
                role: 'alert',
                style: { left, top: `${Math.round(editor.top + editor.height + 4)}px` },
              },
              editor.error,
            ),
      )
    }

    //#endregion

    //#region sidebar menu

    /**
     * The sidebar session menu's tag entry.
     *
     * `sidebar.workspaces.session.menu.item` hands an entry only the row's identity,
     * so this renders one `role="menuitem"` and defers the actual picking to the
     * palette — one picker, opened over the row the menu belonged to, instead of a
     * second tag UI that would have to be kept in step with it.
     */
    function TagMenuRow(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const palette = props.palette
      const sessionId = props.sessionId
      // The menu's own dismiss hook. The owner always supplies it; the guard keeps
      // a host that stops passing it from taking the entry down with it.
      const hook = props.useMenuOpenState
      const menu = typeof hook === 'function' ? hook() : null
      const setMenuOpen = Array.isArray(menu) ? menu[1] : null
      const open = () => {
        if (typeof setMenuOpen === 'function') setMenuOpen(false)
        palette.openTags(sessionId)
      }
      // The shipped row component when the loader has it, so this row sits in the
      // menu like the ones around it; the fallback keeps the feature alive without
      // it.
      return MenuItemButton === null
        ? h(
            'button',
            { type: 'button', role: 'menuitem', className: 'dsp-menuitem', onClick: open },
            tagIcon(),
            h('span', { className: 'dsp-menuitemlabel' }, t('tags.manage')),
          )
        : h(MenuItemButton, { icon: tagIcon(), onSelect: open }, t('tags.manage'))
    }

    //#endregion

    //#region plugin

    /** Cordis services this plugin cannot run without. */
    const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces', 'configForms']

    /**
     * Mount the palette.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const store = createStore({
        open: false,
        epoch: 0,
        hotkeyLabel: '',
        pendingId: null,
        triedId: null,
        notice: null,
        tags: { ready: false, vocabulary: [], assignments: {} },
        tagRequest: null,
      })

      /** Notices are sequenced so a repeat is still visible. */
      let noticeSeq = 0
      let noticeTimer = null

      /** The shortcut service, once resolved. Kept out of static `inject`. */
      let shortcuts = null

      /** Disposers for the active claim, or null while released. */
      let claimDisposers = null

      /** Rows already asked for, so a dwell never repeats a request. */
      const projectionRequests = new Set()

      /** Pending dwell timer, or null. */
      let projectionTimer = null


      ctx.effect(() => ctx.locale.register(NS, DICT), `${NS}: dictionaries`)

      /**
       * Translator for text raised outside the component (row notices).
       *
       * Bound after the dictionary registers. `bind` resolves at call time, so
       * ordering is belt-and-braces rather than strict necessity.
       */
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        if (document.querySelector(`style[data-plugin-css="${NS}"]`) !== null) return undefined
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', NS)
        style.textContent = CSS
        document.head?.appendChild(style)
        return () => style.remove()
      }, `${NS}: styles`)

      // Reading Config is deliberately forgiving: the settings scope reports
      // nothing until its first load lands, and a missing value must fall back to
      // the schema default rather than disable the plugin.
      const form =
        typeof ctx.configForms?.get === 'function' ? ctx.configForms.get(ROW_ID) : undefined

      const configValue = () => {
        if (form === undefined || typeof form.getSnapshot !== 'function') return {}
        let snapshot
        try {
          snapshot = form.getSnapshot()
        } catch (error) {
          console.warn(`${NS}: settings read failed`, error)
          return {}
        }
        const value = snapshot !== null && typeof snapshot === 'object' ? snapshot.value : undefined
        return value !== null && typeof value === 'object' && value !== undefined ? value : {}
      }

      const wantsTakeOver = () => configValue().takeOver !== false

      /**
       * Tag storage, mirrored into the palette store.
       *
       * The Config form is the durable store — volatile fields, so a write updates
       * the running plugin instead of remounting it, which is what keeps the
       * palette open while a tag is saved. The palette store is what the component
       * re-renders from, so there is one subscription rather than a snapshot read
       * tucked inside the model.
       */
      let tagCache = { ready: false, vocabulary: [], assignments: {} }

      const readTags = () => {
        const value = configValue()
        const vocabulary = normalizeVocabulary(value.tags)
        return {
          // `undefined`, not empty: a missing field means the running Host's schema
          // predates tags, so any write would be dropped. Saying so is better than
          // letting the user build a vocabulary that cannot be saved.
          ready: Array.isArray(value.tags) && Array.isArray(value.assignments),
          vocabulary,
          assignments: normalizeAssignments(value.assignments, new Set(vocabulary.map((tag) => tag.id))),
        }
      }

      const syncTags = () => {
        tagCache = readTags()
        store.update((state) => ({ ...state, tags: tagCache }))
      }

      /** Publish an optimistic tag state; the form subscription confirms it. */
      const publishTags = (next) => {
        tagCache = next
        store.update((state) => ({ ...state, tags: tagCache }))
      }

      const writeTagField = (field, value) => {
        if (form === undefined || typeof form.set !== 'function') {
          notify(t('tags.failed'))
          return Promise.resolve(false)
        }
        return Promise.resolve(form.set(field, value)).then(
          (accepted) => {
            if (accepted === false) {
              // A stale revision or a schema that predates the field: re-read so the
              // optimistic value cannot outlive the write that failed.
              syncTags()
              notify(t('tags.failed'))
            }
            return accepted !== false
          },
          (error) => {
            console.warn(`${NS}: tag write failed`, error)
            syncTags()
            notify(t('tags.failed'))
            return false
          },
        )
      }

      /**
       * Add or remove one tag on one session.
       *
       * @param sessionId - which session.
       * @param tagId - which tag.
       * @returns whether the write was accepted.
       */
      const toggleTag = (sessionId, tagId) => {
        if (tagCache.ready !== true) {
          notify(t('tags.notReady'))
          return Promise.resolve(false)
        }
        const current = tagCache.assignments[sessionId] ?? []
        const has = current.includes(tagId)
        if (!has && current.length >= MAX_TAGS) {
          // Refusing with a reason beats a silent no-op: the ceiling is a rule, not
          // a bug, and the third tag is already visible on the row.
          notify(t('tags.full'))
          return Promise.resolve(false)
        }
        const next = has ? current.filter((id) => id !== tagId) : [...current, tagId]
        const assignments = { ...tagCache.assignments }
        if (next.length === 0) delete assignments[sessionId]
        else assignments[sessionId] = next
        publishTags({ ...tagCache, assignments })
        return writeTagField('assignments', assignmentList(assignments))
      }

      /**
       * Create a tag from the picker's draft, applying it to the highlighted row.
       *
       * @param label - trimmed new label.
       * @param sessionId - session to apply it to, or null to only create it.
       * @returns the created tag, or null when nothing could be created.
       */
      const createTag = (label, sessionId) => {
        const text = String(label ?? '').trim()
        if (text === '' || tagCache.ready !== true) return null
        // The new tag inherits the next colour in the ring, so a fresh vocabulary
        // is immediately distinguishable without opening an editor.
        const tag = {
          id: tagIdFor(text, new Set(tagCache.vocabulary.map((entry) => entry.id))),
          label: text,
          emoji: '',
          color: TAG_COLORS[tagCache.vocabulary.length % TAG_COLORS.length],
        }
        publishTags({ ...tagCache, vocabulary: [...tagCache.vocabulary, tag] })
        writeTagField('tags', tagCache.vocabulary)
        if (sessionId !== null && sessionId !== undefined) toggleTag(sessionId, tag.id)
        return tag
      }

      /**
       * Open the palette in tag mode for one session.
       *
       * The sidebar's own menu row calls this, so a tag can be attached without
       * leaving the session list the menu was opened from.
       *
       * @param sessionId - the row the menu belongs to.
       */
      const openTags = (sessionId) => {
        store.update((state) => ({
          ...state,
          open: true,
          epoch: state.open ? state.epoch : state.epoch + 1,
          tagRequest: { id: String(sessionId), seq: ((state.tagRequest?.seq ?? 0) + 1) },
        }))
      }

      const clearTagRequest = () => {
        store.update((state) => (state.tagRequest === null ? state : { ...state, tagRequest: null }))
      }

      // One read at mount, then the form's own subscription: the tag store has a
      // single source of truth, and a write from anywhere (this plugin, the config
      // page, hand-edited YAML) lands in the same place.
      ctx.effect(() => {
        syncTags()
        if (form === undefined || typeof form.subscribe !== 'function') return undefined
        return form.subscribe(() => syncTags())
      }, `${NS}: tag store`)

      const toggle = () => {
        store.update((state) => ({
          ...state,
          open: !state.open,
          epoch: state.open ? state.epoch : state.epoch + 1,
        }))
      }

      const close = () => {
        store.update((state) => (state.open ? { ...state, open: false } : state))
      }

      /**
       * Show a transient line inside the palette.
       *
       * Deliberately not a toast service: the client exposes none, and a plugin
       * must not build a second overlay stack of its own. The palette is on screen
       * whenever a row action can run, so an inline notice is always the right
       * surface for it.
       */
      const notify = (text, undo) => {
        noticeSeq += 1
        store.update((state) => ({ ...state, notice: { text, seq: noticeSeq, undo } }))
        if (noticeTimer !== null) clearTimeout(noticeTimer)
        noticeTimer = setTimeout(() => {
          noticeTimer = null
          store.update((state) => ({ ...state, notice: null }))
        }, NOTICE_MS)
      }

      /** Take the toast down; the Undo button calls it before acting. */
      const dismissNotice = () => {
        if (noticeTimer !== null) {
          clearTimeout(noticeTimer)
          noticeTimer = null
        }
        store.update((state) => (state.notice === null ? state : { ...state, notice: null }))
      }

      const openSession = (id) => {
        ctx.uiWorkspace.openSession(id)
        close()
      }

      /**
       * Archive or restore the highlighted session.
       *
       * `openSession` performs no archive check of its own — the shipped UI
       * guards it — so the palette guards both the open and the toggle.
       */
      const archiveRow = (id, isArchived) => {
        // Pinning and archival are mutually exclusive upstream: archiving drops
        // the pin. Say so rather than letting a flag disappear silently.
        const wasPinned = (ctx.workspaces.list.getSnapshot().pinnedSessionIds ?? []).includes(id)
        const call = isArchived
          ? ctx.uiWorkspace.unarchiveSession(id)
          : ctx.uiWorkspace.archiveSession(id)
        Promise.resolve(call).then(
          () =>
            notify(
              t(
                isArchived
                  ? 'unarchive.done'
                  : wasPinned
                    ? 'archived.droppedPin'
                    : 'archived.done',
              ),
              // Undo is the inverse call, and it deliberately reuses the same
              // path so a restored session lands exactly where it was.
              () => archiveRow(id, !isArchived),
            ),
          (error) => {
            console.warn(`${NS}: archive toggle failed`, error)
            notify(t('archive.failed'))
          },
        )
      }

      /**
       * Pin or unpin the highlighted session.
       *
       * Pin has no shipped chord at all — the sidebar reaches it by mouse only —
       * so ⌘⇧P in the palette is its first keyboard route.
       */
      const togglePin = (id, isPinned) => {
        const call = isPinned
          // `uiWorkspace.pinSession` also maintains the sidebar's manual pin
          // order; the lower-level `workspaces` one does not.
          ? ctx.uiWorkspace.unpinSession(id)
          : ctx.uiWorkspace.pinSession(id)
        Promise.resolve(call).then(
          () => notify(t(isPinned ? 'unpin.done' : 'pin.done'), () => togglePin(id, !isPinned)),
          (error) => {
            console.warn(`${NS}: pin toggle failed`, error)
            notify(t('pin.failed'))
          },
        )
      }

      /**
       * The Session the main view is showing, or null.
       *
       * `retainedBy.mainView` is how the shipped header, the sidebar and the
       * `session.rename` command all answer "which session is current" — reading
       * the same flag keeps this plugin in agreement with them instead of
       * inventing a fourth notion of "current".
       *
       * @returns the session id and its stored title, or null when nothing is open.
       */
      const currentSession = () => {
        const list = ctx.sessions?.list
        const byId =
          typeof list?.getSnapshot === 'function' ? list.getSnapshot()?.byId : undefined
        if (byId === null || byId === undefined) return null
        for (const id of Object.keys(byId)) {
          const row = byId[id]
          if (row === null || row === undefined) continue
          if ((row.retainedBy?.mainView ?? 0) > 0) {
            return { id: String(id), title: typeof row.title === 'string' ? row.title : '' }
          }
        }
        return null
      }

      /**
       * Rename one session through a retained reference.
       *
       * `using` is not a convenience here, it is the contract. The host's rename
       * refuses a session that is not live in its store ("session ... is not live
       * in this store"), and retaining is what makes one live; it is also exactly
       * what the shipped sidebar does for its own row rename, and for any row
       * rather than only the open one. The retain lasts for one call: `using`
       * releases in a `finally`, so the retention count returns to where it was.
       *
       * @param id - session to rename.
       * @param title - trimmed draft; the host normalizes it and may shorten it to
       *   its byte budget, so the accepted value is not necessarily this string.
       * @param previous - title to offer as Undo, or '' to offer none.
       * @returns the title the host actually accepted.
       */
      const renameSession = (id, title, previous) => {
        let call
        try {
          call = ctx.sessions.using(id, { source: RENAME_SOURCE }, (reference) =>
            reference.binding.session.rename(title),
          )
        } catch (error) {
          // `using` is async in the shipped client, so this only fires if the
          // facade changes shape. Reject rather than throw: the caller is a
          // keydown handler, and a synchronous throw there kills the event.
          const reason = error instanceof Error ? error.message : String(error)
          return Promise.reject(new Error(t('rename.failed', { reason })))
        }
        return Promise.resolve(call).then((result) => {
          if (result === undefined || result === null || result.ok !== true) {
            const reason = result?.error?.message ?? t('rename.unavailable')
            throw new Error(t('rename.failed', { reason }))
          }
          const accepted = result.value.title
          // Report the title the HOST stored, not the draft: it collapses
          // whitespace and truncates past `maxTitleBytes`, and the toast is the
          // only place that difference becomes visible.
          notify(
            t('rename.done', { title: accepted }),
            typeof previous === 'string' && previous.trim() !== ''
              ? () => {
                  // Undo is the same path, so the restored title goes through the
                  // same normalization — and Undo has no Undo of its own.
                  renameSession(id, previous, '').catch((error) =>
                    notify(error instanceof Error ? error.message : String(error)),
                  )
                }
              : undefined,
          )
          return accepted
        })
      }

      /**
       * Ask the client to load one session's projections, after a dwell.
       *
       * Cold reads hit the session log and the host's projection LRU holds only
       * five entries, so this waits for the highlight to settle and allows one
       * request at a time. Without the dwell, holding ↓ would issue a request per
       * row.
       */
      const ensureProjections = (id) => {
        if (id === null || id === undefined) return
        if (projectionRequests.has(id)) return
        cancelProjections()
        projectionTimer = setTimeout(() => {
          projectionTimer = null
          if (projectionRequests.has(id)) return
          projectionRequests.add(id)
          store.update((state) => ({ ...state, pendingId: id }))
          const refresh = ctx.sessions?.refreshProjections
          if (typeof refresh !== 'function') {
            store.update((state) => ({ ...state, pendingId: null, triedId: id }))
            return
          }
          Promise.resolve(refresh.call(ctx.sessions, id)).then(
            () =>
              store.update((state) =>
                state.pendingId === id ? { ...state, pendingId: null, triedId: id } : state,
              ),
            (error) => {
              console.warn(`${NS}: projection refresh failed`, error)
              store.update((state) =>
                state.pendingId === id ? { ...state, pendingId: null, triedId: id } : state,
              )
            },
          )
        }, PROJECTION_DWELL_MS)
      }

      const cancelProjections = () => {
        if (projectionTimer === null) return
        clearTimeout(projectionTimer)
        projectionTimer = null
      }

      /** The platform's own spelling of the claimed chord, for the input hint. */
      const hotkeyLabel = () => {
        const platform =
          shortcuts?.platform ??
          (typeof document === 'undefined' ? undefined : document.documentElement.dataset.platform)
        return `${platform === 'darwin' || platform === 'macos' ? '⌘' : 'Ctrl+'}K`
      }

      /**
       * Attach the fixed binding and its observer.
       *
       * This is why the plugin exists, and it writes no preference: the fixed
       * registration has no conflict check, and the conflict it creates for
       * `session.search` is what frees the chord from the main process's
       * intercepted set.
       */
      const claim = () => {
        if (claimDisposers !== null) return
        if (
          shortcuts === null ||
          typeof shortcuts.registerFixed !== 'function' ||
          typeof shortcuts.observeFixedInput !== 'function'
        ) {
          console.warn(`${NS}: shortcut service unavailable — the palette has no hotkey`)
          return
        }
        try {
          const disposers = []
          disposers.push(
            ctx.effect(
              () =>
                shortcuts.registerFixed({
                  id: FIXED_ID,
                  label: () => 'Session palette',
                  keys: [hotkeyLabel()],
                  group: 'application',
                  bindings: [HOTKEY],
                }),
              `${NS}: fixed chord`,
            ),
          )
          disposers.push(
            ctx.effect(
              () =>
                shortcuts.observeFixedInput((input) => {
                  if (input === undefined || input.type !== 'keydown') return
                  const gesture = input.gesture
                  if (gesture === undefined || gesture.code !== HOTKEY.code) return
                  if (gesture.alt || gesture.shift) return
                  // `primary` is meta on macOS and control elsewhere; exactly one.
                  if ((gesture.meta === true) === (gesture.control === true)) return
                  if (gesture.repeat || gesture.composing || gesture.defaultPrevented) return
                  // Fixed input never enters the dispatcher's gate, so the modal
                  // check has to live here: without it ⌘K over Settings mounts the
                  // palette invisibly underneath and eats the chord. Our own
                  // palette is the one modal that must still pass.
                  const modal = input.context === undefined ? null : input.context.modal
                  if (modal !== null && modal !== undefined && modal !== ROW_ID) return
                  input.consume()
                  toggle()
                }),
              `${NS}: fixed observer`,
            ),
          )
          claimDisposers = disposers
          store.update((state) => ({ ...state, hotkeyLabel: hotkeyLabel() }))
        } catch (error) {
          console.error(`${NS}: claiming the chord failed`, error)
        }
      }

      const release = () => {
        if (claimDisposers === null) return
        for (const dispose of claimDisposers) {
          try {
            if (typeof dispose === 'function') dispose()
          } catch (error) {
            console.error(`${NS}: releasing the chord failed`, error)
          }
        }
        claimDisposers = null
        store.update((state) => ({ ...state, hotkeyLabel: '' }))
      }

      /**
       * Reconcile the claim with the persisted switch.
       *
       * Releasing is symmetric now: the plugin writes no shortcut preference, so
       * turning it off restores exactly the shipped default with nothing to undo.
       */
      const applyClaimForConfig = () => {
        if (wantsTakeOver()) claim()
        else release()
      }

      // Adopt the shortcut service. Kept out of the static `inject` array so a
      // missing service disables only the hotkey rather than the whole palette —
      // except that without a hotkey there is no way in, which is why a missing
      // one is reported loudly.
      const adopt = (service) => {
        if (shortcuts !== null) return
        shortcuts = service
        store.update((state) => ({ ...state, hotkeyLabel: hotkeyLabel() }))

        // The companion command registers here rather than at a fixed point in
        // `apply`, because the service may arrive late through `ctx.inject` — an
        // effect installed earlier would have found nothing and never retried.
        // Unbound by default, so it never collides, and user-bindable, which is
        // the fixed binding's only escape hatch.
        ctx.effect(() => {
          if (typeof shortcuts.register !== 'function') return undefined
          return shortcuts.register({
            id: COMMAND_ID,
            label: () => 'Session palette',
            aliases: ['session palette', 'switch session', 'find session'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [ROW_ID],
            resolve: () => ({ status: 'handled', run: toggle }),
          })
        }, `${NS}: companion command`)

        applyClaimForConfig()
      }

      try {
        const direct = ctx.get('shortcuts')
        if (direct !== undefined && direct !== null) adopt(direct)
      } catch (error) {
        console.warn(`${NS}: ctx.get('shortcuts') threw`, error)
      }

      if (shortcuts === null && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['shortcuts'], (scoped) => {
            const service =
              (typeof scoped.get === 'function' ? scoped.get('shortcuts') : undefined) ??
              scoped.shortcuts
            if (service !== undefined && service !== null) adopt(service)
          })
        } catch (error) {
          console.warn(`${NS}: ctx.inject(['shortcuts']) threw`, error)
        }
      }

      // React to settings changes once the scope has loaded.
      ctx.effect(() => {
        if (form === undefined || typeof form.subscribe !== 'function') return undefined
        return form.subscribe(() => applyClaimForConfig())
      }, `${NS}: settings subscription`)

      // Built once, so the inject face the slot hands the component has a stable
      // identity across renders and can be an effect dependency.
      const paletteFace = {
        store,
        close,
        notify,
        openSession,
        archiveRow,
        togglePin,
        rename: renameSession,
        currentSession,
        toggleTag,
        createTag,
        openTags,
        clearTagRequest,
        dismissNotice,
        ensureProjections,
        cancelProjections,
      }

      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                id: ROW_ID,
                order: 900,
                locale: NS,
                inject: () => ({ palette: paletteFace }),
              },
              PaletteEntry,
            ),
          ),
        `${NS}: overlay entry`,
      )

      // The toast is a second entry in the same seat: additive, and mounted even
      // while the palette is closed, which is the whole point.
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                id: `${ROW_ID}.toast`,
                order: 950,
                locale: NS,
                inject: () => ({ palette: paletteFace }),
              },
              NoticeToast,
            ),
          ),
        `${NS}: toast entry`,
      )

      // A third entry in the same seat, and the only one that is not the palette:
      // the double-click editor on the conversation header's title. It has to be
      // its own entry because it must render while the palette is closed.
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                id: `${ROW_ID}.title`,
                order: 940,
                locale: NS,
                inject: () => ({ palette: paletteFace }),
              },
              HeaderTitleEditor,
            ),
          ),
        `${NS}: title editor entry`,
      )

      // The sidebar's session menu. Additive: a fresh id beside Pin/Rename/Fork/
      // Archive, ordered after the shipped `session-id` row.
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
            ctx.slots.register(
              {
                name: 'sidebar.workspaces.session.menu.item',
                id: `${ROW_ID}.tags`,
                order: 460,
                locale: NS,
                inject: () => ({ palette: paletteFace }),
              },
              TagMenuRow,
            ),
          ),
        `${NS}: tag menu row`,
      )

      ctx.effect(
        () => () => {
          release()
          cancelProjections()
          if (noticeTimer !== null) clearTimeout(noticeTimer)
        },
        `${NS}: teardown`,
      )
    }

    return { inject, apply }
    //#endregion
  },
})
