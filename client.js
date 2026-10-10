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
        'preview.footer': '↑↓ move · ⏎ open · tab drawer · ⌘⇧P pin · ⌘⇧⌫ archive · esc',
        'archived.open': 'Archived — restore it first',
        'pin.archived': 'Archived sessions cannot be pinned',
        'archived.done': 'Archived',
        'archived.droppedPin': 'Archived, and unpinned',
        'unarchive.done': 'Restored',
        'archive.failed': 'Could not change the archive state',
        'pin.done': 'Pinned',
        'unpin.done': 'Unpinned',
        'pin.failed': 'Could not change the pin',
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
        'preview.footer': '↑↓ 移动 · ⏎ 打开 · tab 抽屉 · ⌘⇧P 置顶 · ⌘⇧⌫ 归档 · esc',
        'archived.open': '已归档，需先恢复',
        'pin.archived': '归档会话不能置顶',
        'archived.done': '已归档',
        'archived.droppedPin': '已归档（置顶已移除）',
        'unarchive.done': '已恢复',
        'archive.failed': '没能改变归档状态',
        'pin.done': '已置顶',
        'unpin.done': '已取消置顶',
        'pin.failed': '没能改变置顶状态',
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
.dsp-rowtitle{font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-rowsub{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsp-rowsub span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsp-mark{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsp-dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-idle-primary)}
.dsp-dot-on{background:var(--dsw-alias-state-business-primary)}
.dsp-dot-warn{background:var(--dsw-alias-state-warn-primary)}
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

      const list = sessionHook((snapshot) => snapshot)
      const statuses = statusHook((snapshot) => snapshot)
      const workspaces = workspaceHook((snapshot) => snapshot)

      const [query, setQuery] = React.useState('')
      const [view, setView] = React.useState('recents')
      const [manualActiveId, setManualActiveId] = React.useState(null)
      const [now, setNow] = React.useState(() => Date.now())

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

          const title =
            typeof row.displayTitle === 'string' && row.displayTitle !== ''
              ? row.displayTitle
              : folderLabel(row.cwd) !== ''
                ? folderLabel(row.cwd)
                : String(id)
          const workspace = titles.get(id) ?? folderLabel(row.cwd)
          let rank
          if (needle !== '') {
            rank = rankCandidate([title, workspace], needle)
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
            workspace,
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
          pinnedTotal,
          archivedTotal,
          subagentHidden,
          count: listed,
          truncated: total > rows.length,
        }
      }, [list, statuses, titles, archivedIds, pinnedIds, pinIndex, query, now, t, view])

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
          if (isArchived) {
            palette.notify(t('archived.open'))
            return
          }
          palette.openSession(row.id)
        },
        [palette, t],
      )

      const onKeyDown = React.useCallback(
        (event) => {
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
          }
        },
        [move, model, activate, activeRow, archivedIds, palette, pickView, view],
      )

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
                // Without this the click moves focus to <body>, after which no
                // keydown passes through the card and every shortcut dies — on a
                // path (an archived row) that deliberately keeps the palette open.
                onMouseDown: (event) => event.preventDefault(),
                onMouseEnter: () => setManualActiveId(row.id),
                onClick: () => activate(row, archivedIds.has(row.id)),
              },
              h(
                'div',
                { className: 'dsp-rowmain' },
                h('div', { className: 'dsp-rowtitle' }, row.title),
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
            { className: 'dsp-inputrow' },
            h('input', {
              ref: inputRef,
              className: 'dsp-input',
              type: 'text',
              role: 'combobox',
              'aria-expanded': 'true',
              'aria-controls': 'dsp-listbox',
              'aria-activedescendant':
                activeId === null ? undefined : `dsp-opt-${domSafe(activeId)}`,
              'aria-autocomplete': 'list',
              placeholder: t('palette.placeholder'),
              value: query,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => setQuery(event.target.value),
            }),
            h('span', { className: 'dsp-keyhint' }, state.hotkeyLabel ?? ''),
          ),
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
            h('div', { className: 'dsp-pane' }, preview),
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
