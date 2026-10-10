/**
 * Session Palette Probe — browser half.
 *
 * A throwaway Phase 0 diagnostic. It answers the three questions that cannot be
 * settled by reading the shipped bundles, because each depends on live runtime
 * state or on an interaction between two processes:
 *
 *   R1  Does every row of the session list already carry a `turnOutline`
 *       projection value? The preview pane of the real palette is free only if
 *       the answer is yes; the projection cache is written at `turn/end`, but
 *       the registry's `cachedSnapshot` returns only materialized cells, and it
 *       was not decidable statically whether a never-retained session has one.
 *
 *   R2  Does `inject: ['shortcuts']` resolve for a profile-installed bundle?
 *       `shortcuts` is absent from the Client Service catalog even though
 *       `ui-workspace` injects it, so resolution is proven only by trying.
 *       The service is therefore resolved inside `ctx.inject`, never in the
 *       static `inject` array, so the probe still mounts when it is missing.
 *
 *   R3  Does a `registerFixed` chord actually reach the page on macOS Electron?
 *       The claim is that making `session.search` *conflicted* removes the
 *       chord from the main process's natively intercepted set (`keys`), which
 *       is what stops Electron swallowing it. If that reasoning is wrong, ⌘K
 *       never arrives and the whole plan needs a different mechanism.
 *
 * Nothing here ships. It mounts one `shell.overlay` entry — the seat the real
 * palette will use, so R3 doubles as a placement smoke test — and reports
 * findings in a panel that opens on first render.
 *
 * @module dsh-plugin-session-palette-probe/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-session-palette-probe',
  factory(require) {
    const React = require('react')

    const h = React.createElement

    /** Locale namespace; also the slot registration's `locale` key. */
    const NS = 'dsh-plugin-session-palette-probe'

    /** The frame-wide floating seat the real palette will also use. */
    const SLOT = 'shell.overlay'

    /**
     * Fixed-command id.
     *
     * The dotted shape is load-bearing, not cosmetic: `protocol.js` validates
     * ids against `/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/`, and an
     * id that fails it makes the desktop `shortcutsGet` reject the entire
     * definition catalog, which flips the shortcuts config to `unreadable` and
     * silently disables every keyboard command in the app.
     */
    const FIXED_ID = 'session-palette.toggle'

    /** Bumped to force a recomputation of the session-list census. */
    const REFRESH_STORE = 'session-palette-probe: epoch'

    //#region minimal external store

    /**
     * Shallow equality over own enumerable keys.
     *
     * The safety net that keeps a re-render from becoming a loop: an effect may
     * legitimately ask for a refresh on every render, and the refresh publishes
     * a fresh object. Without this guard that pair never settles.
     */
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
     * The probe renders with `useSyncExternalStore`, which needs a stable
     * `getSnapshot` identity and a `subscribe` that returns a disposer. Rolling
     * it here keeps the probe down to a single `react` require, matching how the
     * shipping plugin will be written.
     *
     * @param initial - first snapshot.
     * @returns the store handle.
     */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      const emit = () => {
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            console.error('session-palette-probe: listener failed', error)
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

    /**
     * `useSyncExternalStore` with a subscription fallback.
     *
     * Chosen once at module scope rather than per render: a per-render branch
     * would be a conditional hook call.
     */
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

    //#region formatting helpers

    /** Render an unknown thrown value as one line. */
    function message(error) {
      if (error instanceof Error) return `${error.name}: ${error.message}`
      return String(error)
    }

    /**
     * Present one normalized binding the way the shortcut reference does.
     *
     * @param binding - `{ code, modifiers, secondCode? }`, or null when unbound.
     * @returns a `primary+alt+KeyK` style label.
     */
    function describeBinding(binding) {
      if (binding === undefined || binding === null) return 'unbound'
      const order = ['primary', 'control', 'meta', 'alt', 'shift']
      const modifiers = Array.isArray(binding.modifiers) ? binding.modifiers.slice() : []
      modifiers.sort((left, right) => order.indexOf(left) - order.indexOf(right))
      return [...modifiers, binding.code, binding.secondCode].filter(Boolean).join('+')
    }

    /** The platform's own keycap spelling for the primary-modifier chord. */
    function primaryKeycap() {
      return 'primary+KeyK'
    }

    /**
     * Reduce one catalog row to the fields the probe reports.
     *
     * @param row - a `ctx.shortcuts.catalog` entry.
     * @returns a plain, renderable summary.
     */
    function summarizeCatalogRow(row) {
      // Configurable rows carry `binding` (one, possibly null); fixed rows carry
      // `bindings` (an array, because a fixed action is a *sequence*). Reading
      // the wrong one silently reports "unbound" for a perfectly good row.
      const binding = Array.isArray(row.bindings)
        ? row.bindings.map(describeBinding).join(' then ') || 'none'
        : describeBinding(row.binding)
      return {
        id: String(row.id),
        binding,
        keys: Array.isArray(row.keys) ? row.keys.join(' ') : '',
        modified: row.modified === true,
        issue: row.issue === null || row.issue === undefined ? 'none' : String(row.issue),
        conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
      }
    }

    /**
     * Census the session-list snapshot for R1.
     *
     * @param list - the `useSessions` snapshot, or undefined when the hook was
     *   not projected into props.
     * @returns counts, the rows without an outline, one sample last turn, and a
     *   census of which projection keys are present at all.
     */
    function census(list) {
      if (list === undefined || list === null) {
        return { available: false }
      }
      const ids = Array.isArray(list.ids) ? list.ids : []
      const byId = list.byId ?? {}
      let rows = 0
      let withOutline = 0
      let emptyOutline = 0
      let noProjections = 0
      let sample = null
      const missing = []
      const keyCensus = new Map()

      for (const id of ids) {
        const row = byId[id]
        if (row === undefined) continue
        rows += 1
        const values = row.projectionValues
        if (values === undefined) noProjections += 1
        else {
          for (const key of Object.keys(values)) {
            keyCensus.set(key, (keyCensus.get(key) ?? 0) + 1)
          }
        }
        const outline = values === undefined ? undefined : values.turnOutline
        if (Array.isArray(outline) && outline.length > 0) {
          withOutline += 1
          if (sample === null) {
            const last = outline[outline.length - 1]
            sample = {
              id: String(id),
              title: row.displayTitle ?? row.title ?? String(id),
              turns: outline.length,
              prompt: typeof last?.prompt === 'string' ? last.prompt : '',
              response: typeof last?.response === 'string' ? last.response : '',
            }
          }
        } else {
          if (Array.isArray(outline)) emptyOutline += 1
          missing.push({
            id: String(id),
            title: row.displayTitle ?? row.title ?? String(id),
            blank: row.blank === true,
            hasProjections: values !== undefined,
            keys: values === undefined ? [] : Object.keys(values),
          })
        }
      }

      return {
        available: true,
        total: ids.length,
        rows,
        withOutline,
        emptyOutline,
        noProjections,
        missing,
        sample,
        keyCensus: [...keyCensus.entries()].sort((left, right) => right[1] - left[1]),
      }
    }

    //#endregion

    //#region dictionaries

    const en = {
      pill: 'Session Palette probe',
      title: 'Session Palette — Phase 0 probe',
      close: 'Close',
      refresh: 'Recompute',
      legendR1: 'R1 — is the last-turn preview already in memory?',
      legendR2: 'R2 — did the shortcuts service resolve for a bundle plugin?',
      legendR3: 'R3 — does a registerFixed chord reach the page?',
      claimOn: 'Claim ⌘K for the probe',
      claimOff: 'Release ⌘K',
      hits: 'Received',
    }

    const zh = {
      pill: '会话面板探针',
      title: '会话面板 — Phase 0 探针',
      close: '关闭',
      refresh: '重新统计',
      legendR1: 'R1 — 最后 turn 的预览是否已在内存里？',
      legendR2: 'R2 — shortcuts 服务对 bundle 插件是否解析成功？',
      legendR3: 'R3 — registerFixed 的按键真的能到达页面吗？',
      claimOn: '让探针占用 ⌘K',
      claimOff: '释放 ⌘K',
      hits: '已收到',
    }

    //#endregion

    //#region styles

    /**
     * Probe CSS.
     *
     * Token-only, like the shipping plugin will be: every colour here is a
     * `--dsw-*` alias so the panel follows light, dark, and any third-party
     * token layer (the author's own Cream theme included) with no extra work.
     */
    const CSS = `
.spp-pill{position:fixed;right:20px;bottom:20px;z-index:30;display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-shadow:var(--dsw-elevation-soft);cursor:pointer}
.spp-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.spp-scrim{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px;background:var(--dsw-alias-bg-mask-1)}
.spp-card{display:flex;flex-direction:column;width:min(780px,100%);max-height:100%;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.spp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.spp-title{font-size:13px;font-weight:600}
.spp-body{overflow:auto;padding:2px 16px 16px}
.spp-section{margin-top:16px}
.spp-section>h4{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.spp-row{display:flex;gap:10px;font-size:12px;line-height:18px}
.spp-k{min-width:170px;flex:none;color:var(--dsw-alias-label-secondary)}
.spp-v{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
.spp-ok{color:var(--dsw-alias-state-success-primary)}
.spp-bad{color:var(--dsw-alias-state-error-primary)}
.spp-warn{color:var(--dsw-alias-state-warn-primary)}
.spp-list{margin:6px 0 0;padding-left:18px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.spp-quote{margin:8px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}
.spp-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.spp-btn{padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}
.spp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.spp-btn:disabled{opacity:.5;cursor:default}
.spp-hint{margin-top:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`

    //#endregion

    //#region component

    /** One `label: value` diagnostic line. */
    function Row({ label, value, tone }) {
      return h(
        'div',
        { className: 'spp-row' },
        h('span', { className: 'spp-k' }, label),
        h('span', { className: tone === undefined ? 'spp-v' : `spp-v spp-${tone}` }, value),
      )
    }

    /**
     * The probe surface: a pill while closed, the diagnostic card while open.
     *
     * `role="dialog"` plus `aria-modal="true"` is not decoration — the host's
     * `modalSelector` matches exactly that, and both the Escape arbitration
     * stack and the shortcuts service's background-command blocking key off it.
     * Rendering these attributes is how the probe also tests that contract.
     */
    function ProbeEntry(props) {
      const probe = props.probe
      const t = typeof props.t === 'function' ? props.t : (key) => key

      const diagnostics = useStore(probe.store)
      const refreshed = React.useRef(false)
      const sessionHook = typeof props.useSessions === 'function' ? props.useSessions : () => undefined
      const workspaceHook =
        typeof props.useWorkspaces === 'function' ? props.useWorkspaces : () => undefined
      const list = sessionHook((state) => state)
      const workspaces = workspaceHook((state) => state)

      const report = React.useMemo(() => census(list), [list, diagnostics.epoch])
      const archived = Array.isArray(workspaces?.archivedSessionIds)
        ? workspaces.archivedSessionIds.length
        : 'n/a'
      const pinned = Array.isArray(workspaces?.pinnedSessionIds)
        ? workspaces.pinnedSessionIds.length
        : 'n/a'

      React.useEffect(() => {
        if (refreshed.current) return
        refreshed.current = true
        probe.refresh()
      }, [probe])

      if (diagnostics.panelOpen !== true) {
        return h(
          'button',
          {
            type: 'button',
            className: 'spp-pill',
            onClick: () => probe.store.update((state) => ({ ...state, panelOpen: true })),
          },
          h('span', null, t('pill')),
        )
      }

      const claimOn = diagnostics.claimState === 'on'
      const ratio =
        report.available && report.total > 0
          ? `${Math.round((report.withOutline / report.total) * 100)}%`
          : 'n/a'

      return h(
        'div',
        {
          className: 'spp-scrim',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) {
              probe.store.update((state) => ({ ...state, panelOpen: false }))
            }
          },
        },
        h(
          'div',
          {
            className: 'spp-card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('title'),
            'data-shortcut-modal': 'session-palette-probe',
          },
          h(
            'div',
            { className: 'spp-head' },
            h('span', { className: 'spp-title' }, t('title')),
            h(
              'button',
              {
                type: 'button',
                className: 'spp-btn',
                onClick: () =>
                  probe.store.update((state) => ({ ...state, panelOpen: false })),
              },
              t('close'),
            ),
          ),
          h(
            'div',
            { className: 'spp-body' },

            // ---- R1 -------------------------------------------------------
            h(
              'section',
              { className: 'spp-section' },
              h('h4', null, t('legendR1')),
              report.available !== true
                ? h(Row, { label: 'useSessions prop', value: 'NOT projected', tone: 'bad' })
                : h(
                    React.Fragment,
                    null,
                    h(Row, { label: 'sessions in list', value: String(report.total) }),
                    h(Row, { label: 'rows with metadata', value: String(report.rows) }),
                    h(Row, {
                      label: 'rows with turnOutline',
                      value: `${report.withOutline}  (${ratio})`,
                      tone: report.withOutline === report.rows ? 'ok' : 'warn',
                    }),
                    h(Row, { label: 'empty outline array', value: String(report.emptyOutline) }),
                    h(Row, { label: 'no projectionValues', value: String(report.noProjections) }),
                    report.sample === null
                      ? null
                      : h(
                          'div',
                          null,
                          h(Row, {
                            label: 'sample title',
                            value: `${report.sample.title}  (${report.sample.turns} turns)`,
                          }),
                          h(
                            'div',
                            { className: 'spp-quote' },
                            `你：${report.sample.prompt}\nDSH：${report.sample.response}`,
                          ),
                        ),
                    report.missing.length === 0
                      ? null
                      : h(
                          'div',
                          null,
                          h(Row, {
                            label: `missing outline (${report.missing.length})`,
                            value: 'first few:',
                            tone: 'warn',
                          }),
                          h(
                            'ul',
                            { className: 'spp-list' },
                            report.missing.slice(0, 6).map((row) =>
                              h(
                                'li',
                                { key: row.id },
                                `${row.title}${row.blank ? ' [blank]' : ''} — projections: ${
                                  row.hasProjections ? row.keys.join(', ') || 'none' : 'absent'
                                }`,
                              ),
                            ),
                          ),
                        ),
                    h(Row, {
                      label: 'projection keys present',
                      value: report.keyCensus.map(([key, count]) => `${key}(${count})`).join('  '),
                    }),
                  ),
            ),

            // ---- R2 -------------------------------------------------------
            h(
              'section',
              { className: 'spp-section' },
              h('h4', null, t('legendR2')),
              h(Row, {
                label: 'resolution',
                value: diagnostics.shortcutResolution,
                tone: diagnostics.shortcutResolution.startsWith('resolved') ? 'ok' : 'bad',
              }),
              h(Row, { label: 'ctx.shortcuts', value: diagnostics.shortcutsType }),
              h(Row, { label: 'runtime / platform', value: `${diagnostics.runtime} / ${diagnostics.platform}` }),
              h(Row, {
                label: 'registerFixed',
                value: diagnostics.fixedSupported,
                tone: diagnostics.fixedSupported === 'yes' ? 'ok' : 'bad',
              }),
              h(Row, { label: 'observeFixedInput', value: diagnostics.observeSupported, tone: diagnostics.observeSupported === 'yes' ? 'ok' : 'bad' }),
              h(Row, { label: 'catalog rows', value: `${diagnostics.catalogSize} configurable` }),
              h(Row, { label: 'fixed rows', value: `${diagnostics.fixedCatalogSize} fixed` }),
              h(Row, { label: 'service methods', value: diagnostics.methods.join(', ') }),
            ),

            // ---- R3 -------------------------------------------------------
            h(
              'section',
              { className: 'spp-section' },
              h('h4', null, t('legendR3')),
              h(Row, {
                label: 'session.search',
                value:
                  diagnostics.searchRow === null
                    ? 'not in catalog'
                    : `${diagnostics.searchRow.binding}  modified=${diagnostics.searchRow.modified}  conflicts=[${diagnostics.searchRow.conflicts.join(', ')}]`,
                tone: diagnostics.searchRow === null ? 'warn' : undefined,
              }),
              h(Row, {
                label: 'our row (catalog)',
                value: diagnostics.ownRow === null ? 'not registered — correct for a fixed command' : 'present (unexpected)',
              }),
              h(Row, {
                label: 'our row (fixedCatalog)',
                value:
                  diagnostics.fixedRow === null
                    ? 'not registered'
                    : `${diagnostics.fixedRow.binding}  keys=${diagnostics.fixedRow.keys}`,
                tone: diagnostics.fixedRow === null ? 'warn' : 'ok',
              }),
              h(Row, {
                label: 'claim state',
                value:
                  diagnostics.claimState === 'error'
                    ? `ERROR — ${diagnostics.claimError}`
                    : diagnostics.claimState,
                tone: diagnostics.claimState === 'error' ? 'bad' : claimOn ? 'ok' : undefined,
              }),
              h(Row, {
                label: 'window capture saw ⌘K',
                value:
                  diagnostics.domHits.length === 0 ? 'nothing yet' : diagnostics.domHits.join('   '),
                tone: diagnostics.domHits.length === 0 ? 'warn' : 'ok',
              }),
              h(Row, {
                label: t('hits'),
                value: diagnostics.hits.length === 0 ? 'nothing yet' : diagnostics.hits.join('   '),
                tone: diagnostics.hits.length === 0 ? 'warn' : 'ok',
              }),
              h(
                'div',
                { className: 'spp-btns' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'spp-btn',
                    disabled: claimOn,
                    onClick: () => probe.enableClaim(),
                  },
                  t('claimOn'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'spp-btn',
                    disabled: !claimOn,
                    onClick: () => probe.disableClaim(),
                  },
                  t('claimOff'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'spp-btn',
                    onClick: () =>
                      probe.store.update((state) => ({ ...state, epoch: (state.epoch ?? 0) + 1 })),
                  },
                  t('refresh'),
                ),
              ),
              h(
                'div',
                { className: 'spp-hint' },
                `While the claim is on, session.search should read conflicts=[${FIXED_ID}]. ` +
                  `Now press ${primaryKeycap()}. Both counters should light up: “window capture” ` +
                  'proves the chord reached the page at all, “fixed observer” proves the ' +
                  'fixed-input plumbing delivered it. If only the first lights up the mechanism ' +
                  'is real but the wiring is wrong; if neither does, Electron is still swallowing ' +
                  'the chord. Release the claim when done.',
              ),
            ),

            // ---- context --------------------------------------------------
            h(
              'section',
              { className: 'spp-section' },
              h('h4', null, 'context'),
              h(Row, { label: 'archivedSessionIds', value: String(archived) }),
              h(Row, { label: 'pinnedSessionIds', value: String(pinned) }),
            ),
          ),
        ),
      )
    }

    //#endregion

    //#region plugin

    /** Cordis services this plugin cannot run without. */
    const inject = ['slots', 'locale']

    /**
     * Mount the probe.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const store = createStore({
        panelOpen: true,
        epoch: 0,
        shortcutResolution: 'not attempted',
        shortcutsType: 'unavailable',
        runtime: '?',
        platform: '?',
        methods: [],
        catalogSize: 0,
        fixedCatalogSize: 0,
        fixedSupported: '?',
        observeSupported: '?',
        searchRow: null,
        ownRow: null,
        fixedRow: null,
        claimState: 'off',
        claimError: null,
        hits: [],
        domHits: [],
      })

      /** The resolved service, or null while it is absent. */
      let shortcuts = null

      /** Disposers for the active claim, or null while released. */
      let claimDisposers = null

      ctx.effect(() => ctx.locale.register(NS, { en, zh }), `${NS}: dictionaries`)

      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const existing = document.querySelector(`style[data-plugin-css="${NS}"]`)
        if (existing !== null && existing !== undefined) return undefined
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', NS)
        style.textContent = CSS
        document.head?.appendChild(style)
        return () => {
          style.remove()
        }
      }, `${NS}: styles`)

      /**
       * Re-read everything the shortcuts service exposes.
       *
       * Called after resolution, after every catalog change, and after a
       * claim/release, so the panel always reflects the live registry.
       */
      const refreshShortcuts = () => {
        if (shortcuts === null) return
        let catalog = []
        let fixedCatalog = []
        try {
          catalog = shortcuts.catalog?.getSnapshot?.() ?? []
        } catch (error) {
          console.error(`${NS}: catalog read failed`, error)
        }
        try {
          fixedCatalog = shortcuts.fixedCatalog?.getSnapshot?.() ?? []
        } catch (error) {
          console.error(`${NS}: fixedCatalog read failed`, error)
        }
        const find = (rows, id) => {
          const row = rows.find((candidate) => candidate.id === id)
          return row === undefined ? null : summarizeCatalogRow(row)
        }
        store.update((state) => ({
          ...state,
          runtime: String(shortcuts.runtime ?? '?'),
          platform: String(shortcuts.platform ?? '?'),
          catalogSize: catalog.length,
          fixedCatalogSize: fixedCatalog.length,
          // Enumerating a cordis Service proxy yields nothing: the service is a
          // Proxy whose methods live behind get traps, so `Object.keys` is empty
          // even though every method works. Kept as a visible reminder not to
          // feature-detect by enumeration in the real plugin.
          methods: Object.keys(shortcuts)
            .filter((key) => typeof shortcuts[key] === 'function')
            .sort(),
          fixedSupported: typeof shortcuts.registerFixed === 'function' ? 'yes' : 'NO',
          observeSupported: typeof shortcuts.observeFixedInput === 'function' ? 'yes' : 'NO',
          searchRow: find(catalog, 'session.search'),
          ownRow: find(catalog, FIXED_ID),
          // Our command is FIXED, so it lands in fixedCatalog, never catalog.
          fixedRow: find(fixedCatalog, FIXED_ID),
        }))
      }

      /**
       * Adopt a resolved service and subscribe to its catalog.
       *
       * @param service - the shortcuts service instance.
       * @param how - how it was reached, reported verbatim in the panel.
       */
      const adopt = (service, how) => {
        if (shortcuts !== null) return
        shortcuts = service
        store.update((state) => ({
          ...state,
          shortcutResolution: how,
          shortcutsType: typeof service,
        }))
        refreshShortcuts()
        ctx.effect(() => {
          const unsubscribe = shortcuts.catalog?.subscribe?.(() => refreshShortcuts())
          return () => {
            if (typeof unsubscribe === 'function') unsubscribe()
          }
        }, `${NS}: catalog subscription`)
      }

      // R2, branch one: read it directly. A bundle plugin gets the real ctx, so
      // this is expected to succeed; it is recorded rather than assumed.
      try {
        const direct = ctx.get('shortcuts')
        if (direct !== undefined && direct !== null) {
          adopt(direct, 'resolved via ctx.get("shortcuts")')
        }
      } catch (error) {
        store.update((state) => ({
          ...state,
          shortcutResolution: `ctx.get threw ${message(error)}`,
        }))
      }

      // R2, branch two: wait for it. Kept out of the static `inject` array so a
      // missing service degrades to a reported failure instead of an unmounted
      // plugin — which is exactly what we need to observe.
      if (shortcuts === null && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['shortcuts'], (scoped) => {
            const service =
              (typeof scoped.get === 'function' ? scoped.get('shortcuts') : undefined) ??
              scoped.shortcuts
            if (service === undefined || service === null) return
            adopt(service, 'resolved via ctx.inject(["shortcuts"])')
          })
        } catch (error) {
          store.update((state) => ({
            ...state,
            shortcutResolution: `ctx.inject threw ${message(error)}`,
          }))
        }
      }

      // R3: claim the chord with a fixed registration, which performs no
      // conflict check. Making session.search conflicted is the mechanism, not
      // a side effect — it is what removes the chord from the main process's
      // intercepted set so the DOM event survives to this listener.
      const enableClaim = () => {
        if (claimDisposers !== null) return
        if (
          shortcuts === null ||
          typeof shortcuts.registerFixed !== 'function' ||
          typeof shortcuts.observeFixedInput !== 'function'
        ) {
          store.update((state) => ({
            ...state,
            claimState: 'error',
            claimError: 'shortcuts service or fixed-input API unavailable',
          }))
          return
        }
        try {
          const disposers = []

          disposers.push(
            ctx.effect(
              () =>
                shortcuts.registerFixed({
                  id: FIXED_ID,
                  label: () => 'Session Palette probe: open',
                  keys: [primaryKeycap()],
                  group: 'application',
                  bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
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
                  if (gesture === undefined || gesture.code !== 'KeyK') return
                  if (gesture.alt || gesture.shift) return
                  // Exactly one of meta/control: `primary` is meta on macOS and
                  // control elsewhere, and both together is a different chord.
                  if ((gesture.meta === true) === (gesture.control === true)) return
                  if (gesture.repeat) return
                  input.consume()
                  const at = new Date().toLocaleTimeString()
                  store.update((state) => ({
                    ...state,
                    panelOpen: true,
                    hits: [at, ...state.hits].slice(0, 6),
                  }))
                }),
              `${NS}: fixed input listener`,
            ),
          )

          // Control experiment, so a failure can be attributed instead of just
          // observed. This is a raw DOM capture listener, deliberately separate
          // from the fixed-input API: if it fires while the fixed observer stays
          // silent, the fixed plumbing is at fault; if neither fires, Electron
          // is still swallowing the chord before the page ever sees it.
          disposers.push(
            ctx.effect(() => {
              if (typeof window === 'undefined') return undefined
              const onKeyDown = (event) => {
                if (event.code !== 'KeyK') return
                if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
                if (event.repeat) return
                const at = new Date().toLocaleTimeString()
                store.update((state) => ({
                  ...state,
                  domHits: [at, ...state.domHits].slice(0, 6),
                }))
              }
              window.addEventListener('keydown', onKeyDown, true)
              return () => window.removeEventListener('keydown', onKeyDown, true)
            }, `${NS}: DOM control listener`),
          )

          claimDisposers = disposers
          store.update((state) => ({ ...state, claimState: 'on', claimError: null }))
          refreshShortcuts()
        } catch (error) {
          store.update((state) => ({
            ...state,
            claimState: 'error',
            claimError: message(error),
          }))
        }
      }

      const disableClaim = () => {
        if (claimDisposers !== null) {
          for (const dispose of claimDisposers) {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.error(`${NS}: release failed`, error)
            }
          }
          claimDisposers = null
        }
        store.update((state) => ({ ...state, claimState: 'off' }))
        refreshShortcuts()
      }

      // `slots.inject` is required, not optional: `register` throws when the
      // target slot is not declared yet, and ui-layout's declaration order
      // relative to this plugin is not constrained. The wrapper waits for the
      // declaration, and re-registers if it ever collapses and returns.
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                id: 'session-palette-probe',
                order: 900,
                locale: NS,
                inject: () => ({
                  probe: {
                    store,
                    refresh: refreshShortcuts,
                    enableClaim,
                    disableClaim,
                  },
                }),
              },
              ProbeEntry,
            ),
          ),
        `${NS}: overlay entry`,
      )

      // Release the chord if the plugin unloads while it is claimed.
      ctx.effect(
        () => () => {
          disableClaim()
        },
        REFRESH_STORE,
      )
    }

    return { inject, apply }
    //#endregion
  },
})
