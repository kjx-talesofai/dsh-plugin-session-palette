/**
 * Contract test for dsh-plugin-session-palette.
 *
 * There is no browser here, so the suite drives the plugin through the
 * boundaries it owns and is explicit about the ones it does not.
 *
 *   Proven here
 *   - `client.js` runs as a plain script (`node:vm`) against a
 *     `window.__ModuleLoader__` facade and registers the package's own id, i.e.
 *     the shipped artifact really is a script-executable client bundle.
 *   - it requires only `react`, so materialization cannot miss the loader table,
 *     and it imports no `@deepseek-ai/*` client package.
 *   - the ids that must agree do: the Loader row in `cordis.patch.yml`, the
 *     browser half's `ROW_ID` (the settings namespace `dsh-settings` derives),
 *     and the locale namespace. Both shortcut command ids satisfy the shortcut
 *     protocol's dotted-id pattern, which is load-bearing on desktop: a failing
 *     id makes the definitions IPC reject the whole catalog and silently kills
 *     every keyboard command in the app.
 *   - the host half's Config carries both switches as `volatile` booleans
 *     defaulting to true, and a non-volatile field would make the namespace
 *     invisible to the page.
 *   - `apply` wires the two contributions the design claims: exactly one
 *     `slots.inject('shell.overlay', …)` registration, and a fixed shortcut
 *     binding plus its observer. Every effect hands back a real disposer,
 *     because a missing one breaks the next hot re-apply.
 *   - the hotkey pipeline behaves: ⌘K toggles, consumes the gesture, and ignores
 *     repeats, ⇧⌘K, ⌥⌘K, both-modifiers-together, and sequence resets.
 *   - `takeOver: false` claims nothing; `moveSidebarSearch` gates the relocation
 *     of the shipped `session.search` command, which is skipped whenever the user
 *     has already touched that binding.
 *   - the pure derivation is correct: recency buckets at calendar boundaries,
 *     elapsed-time thresholds, activity tier ordering, folder labels, workspace
 *     title resolution, the fuzzy matcher's subsequence/prefix precedence, the
 *     store's publish suppression, and the projection dwell's single-flight.
 *   - rename behaves as a second mode of the search field: ⌘⇧R seeds the draft
 *     from the STORED title (never the folder/id fallback), the input's role
 *     flips to `textbox`, Enter writes through `sessions.using` with this
 *     plugin's retain source, an unchanged or blank draft never leaves the page,
 *     a rejection keeps the draft and shows the host's reason, Escape cancels
 *     without a request, IME composition owns Enter, the arrows stay the text
 *     field's, and the toast reports the accepted title with an Undo only when
 *     there was a title to go back to.
 *
 *   NOT proven here
 *   - anything the real harness owns: `ui-slots`/`ui-renderer` prop composition,
 *     `dsh-client-locale`'s live resolution, `dsh-sessions`' real projection
 *     payloads, `dsh-workspaces`' snapshot, and the Electron main process's
 *     native interception. Those are stubbed. The rendered pixels, the real ⌘K
 *     delivery on macOS, and the actual `turnOutline` coverage were verified
 *     against the running app by hand instead — see docs/plan.md §10.
 *   - the real DOM. The component IS rendered here, through a hooks runtime that
 *     settles effects and re-renders on state change, but focus, text selection,
 *     layout, and whether ⌘⇧R actually reaches the page remain browser-verified —
 *     see docs/plan.md §11.4.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const clientSource = readFileSync(join(root, 'client.js'), 'utf8')
const hostSource = readFileSync(join(root, 'index.js'), 'utf8')
const patchSource = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

const SLOT = 'shell.overlay'
const FIXED_ID = 'session-palette.toggle'
const COMMAND_ID = 'session.palette'
const ROW_ID = 'session-palette'
const NS = pkg.name

/** The shortcut protocol's id pattern; an id that misses it kills the catalog. */
const COMMAND_PATTERN = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u

/**
 * Expose the factory's closure-local helpers to the suite.
 *
 * The shipping file must keep returning exactly `{ inject, apply }`, so the
 * transform is asserted to match before it is used — a silent miss would turn
 * every internals test into a confusing `undefined`.
 */
const RETURN_STATEMENT = 'return { inject, apply }'
const INTERNALS = [
  'bucketOf',
  'agoParts',
  'agoText',
  'tierOf',
  'pendingKey',
  'folderLabel',
  'workspaceTitles',
  'classify',
  'domSafe',
  'alignmentScore',
  'rankCandidate',
  'compareRows',
  'comparePinned',
  'createStore',
]
const instrumentedSource = clientSource.replace(
  RETURN_STATEMENT,
  `return { inject, apply, __internals: { ${INTERNALS.join(', ')} } }`,
)

//#region harness

/** A React stub good enough for `apply`; the component is never rendered here. */
function reactStub() {
  // A small but real hooks runtime. The previous stub had a no-op `useState`, so
  // the component could not be driven at all: every setState was discarded and
  // no view or query was ever reachable. Slots persist across renders, effects
  // run once per dependency change, and a setter marks the tree dirty so the
  // harness can settle it.
  const hooks = { slots: [], cursor: 0, pending: [], cleanups: [], dirty: false }
  const sameDeps = (left, right) =>
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))

  const api = {
    createElement: (...args) => ({ type: args[0], props: args[1] ?? {}, children: args.slice(2) }),
    Fragment: Symbol('react.fragment'),
    useRef: (initial) => {
      const index = hooks.cursor++
      if (hooks.slots[index] === undefined) hooks.slots[index] = { current: initial ?? null }
      return hooks.slots[index]
    },
    useState: (initial) => {
      const index = hooks.cursor++
      if (hooks.slots[index] === undefined) {
        hooks.slots[index] = typeof initial === 'function' ? initial() : initial
      }
      const set = (next) => {
        const value = typeof next === 'function' ? next(hooks.slots[index]) : next
        if (Object.is(value, hooks.slots[index])) return
        hooks.slots[index] = value
        hooks.dirty = true
      }
      return [hooks.slots[index], set]
    },
    useEffect: (run, deps) => {
      const index = hooks.cursor++
      const slot = hooks.slots[index]
      if (slot === undefined || !sameDeps(slot, deps)) {
        hooks.slots[index] = deps
        hooks.pending.push(run)
      }
    },
    useMemo: (compute, deps) => {
      const index = hooks.cursor++
      const slot = hooks.slots[index]
      if (slot === undefined || !sameDeps(slot.deps, deps)) {
        hooks.slots[index] = { deps, value: compute() }
      }
      return hooks.slots[index].value
    },
    useCallback: (callback, deps) => api.useMemo(() => callback, deps),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  api.useLayoutEffect = api.useEffect
  return { react: api, hooks }
}

/**
 * Walk a rendered tree, expanding function components.
 *
 * Handlers must be re-read from a fresh tree after every state change: the
 * closures captured in an older tree see the older state and would silently do
 * nothing.
 */
function collect(node, extra, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, extra, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') {
    collect(node.type({ ...extra, ...node.props }), extra, out)
    return out
  }
  out.push(node)
  for (const child of node.children ?? []) collect(child, extra, out)
  return out
}

/**
 * Mount a slot component and drive it.
 *
 * @returns `render()` for a settled tree, `nodes()` for every host element, and
 *   `find(className)` for the first matching node.
 */
function mount(loaded, record, options = {}) {
  const entryId = options.entryId ?? ROW_ID
  const entry = record.slotRegistrations.find((row) => row.options.id === entryId)
  assert.ok(entry !== undefined, `no registration for ${entryId}`)
  const palette = entry.options.inject().palette

  // Values included on purpose: a stub that renders only the key names makes
  // every count assertion vacuous.
  const translate = (key, params) => (params === undefined ? key : `${key}(${JSON.stringify(params)})`)

  const extra = {
    ...(options.props ?? {}),
    palette,
    t: translate,
    useSessions: (selector) => selector(options.sessions ?? { ids: [], byId: {}, projectionsBySession: {} }),
    useSessionStatus: (selector) => selector(options.statuses ?? new Map()),
    useMenuOpenState: () => [false, options.onMenuDismiss ?? (() => {})],
    useWorkspaces: (selector) =>
      selector({ items: [], archivedSessionIds: [], pinnedSessionIds: [], ...(options.workspaces ?? {}) }),
  }

  let tree = null
  const render = () => {
    for (let pass = 0; pass < 25; pass += 1) {
      loaded.hooks.cursor = 0
      loaded.hooks.pending = []
      loaded.hooks.dirty = false
      tree = entry.component(extra)
      for (const run of loaded.hooks.pending) {
        const cleanup = run()
        if (typeof cleanup === 'function') loaded.hooks.cleanups.push(cleanup)
      }
      if (loaded.hooks.dirty === false) break
    }
    return tree
  }

  // EXACT class tokens, never substrings: `dsp-row` is a prefix of
  // `dsp-rowmain`/`dsp-rowtitle`/`dsp-rowsub`, and `dsp-view` of `dsp-views`.
  const hasClass = (node, className) =>
    String(node.props.className ?? '')
      .split(/\s+/)
      .includes(className)
  const nodes = () => collect(render(), extra)
  const find = (className) => nodes().find((node) => hasClass(node, className)) ?? null
  const all = (className) => nodes().filter((node) => hasClass(node, className))

  return { render, nodes, find, all, palette, extra, entry }
}

/** Build a session-list snapshot from compact row descriptions. */
function sessionsOf(rows) {
  const byId = {}
  const ids = []
  for (const row of rows) {
    ids.push(row.id)
    byId[row.id] = {
      displayTitle: row.title ?? row.id,
      // The STORED title is a separate field from the displayed one: the palette
      // seeds its editor from this, and an untitled session must have no stored
      // title even though it still displays something.
      ...(row.title === undefined ? {} : { title: row.title }),
      updatedAt: row.updatedAt ?? 1_000,
      blank: row.blank ?? false,
      origin: row.origin,
      running: row.running ?? false,
      cwd: row.cwd,
    }
  }
  return { ids, byId, phase: 'ready', projectionsBySession: {} }
}

/**
 * Evaluate `client.js` and hand back the plugin object it registers.
 *
 * @param options - timer control plus the values a mock context should report.
 * @returns the plugin, the captured id, and spies over everything it touched.
 */
function loadPlugin(options = {}) {
  const timers = []
  const documentElement = { dataset: { platform: options.platform ?? 'darwin' } }
  const appended = []
  const removedStyles = []

  // The double-click editor attaches its listener to the document, so the stub
  // has to keep them: a no-op `addEventListener` made that path untestable.
  const listeners = {}
  const document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      setAttribute() {},
      set textContent(value) {
        this._text = value
      },
      get textContent() {
        return this._text
      },
      remove: () => removedStyles.push(true),
    }),
    head: { appendChild: (element) => appended.push(element) },
    activeElement: null,
    addEventListener(type, listener) {
      const bucket = (listeners[type] ??= [])
      bucket.push(listener)
    },
    removeEventListener(type, listener) {
      const bucket = listeners[type] ?? []
      const index = bucket.indexOf(listener)
      if (index !== -1) bucket.splice(index, 1)
    },
    querySelectorAll: () => [],
    documentElement,
  }

  const sandbox = {
    console,
    document,
    // The component asks `document.activeElement instanceof HTMLElement` before
    // saving focus, so the global has to exist even when nothing is focused.
    HTMLElement: class HTMLElement {},
    // Without this the plugin falls back to a null controller and the abort
    // path is unreachable, so the test would verify nothing.
    AbortController,
    Date,
    Math,
    Number,
    Object,
    Array,
    Set,
    Map,
    JSON,
    RegExp,
    String,
    Symbol,
    Promise,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    undefined,
    setTimeout: (fn, ms) => {
      const handle = { fn, ms, cleared: false }
      timers.push(handle)
      return handle
    },
    clearTimeout: (handle) => {
      if (handle !== undefined && handle !== null) handle.cleared = true
    },
    requestAnimationFrame: (fn) => {
      fn()
      return 1
    },
    cancelAnimationFrame: () => {},
    window: {},
  }
  sandbox.globalThis = sandbox

  let captured = null
  sandbox.window.__ModuleLoader__ = {
    load: (definition) => {
      captured = definition
    },
  }

  vm.createContext(sandbox)
  new vm.Script(instrumentedSource, { filename: 'client.js' }).runInContext(sandbox)

  assert.ok(captured !== null, 'client.js did not call window.__ModuleLoader__.load')
  const stub = reactStub()
  const plugin = captured.factory((name) => {
    if (name === 'react') return stub.react
    throw new Error(`client.js required "${name}", which the loader table may not carry`)
  })

  return {
    plugin,
    hooks: stub.hooks,
    id: captured.id,
    appended,
    removedStyles,
    listeners,
    timers,
    flushTimers() {
      const pending = timers.splice(0)
      for (const handle of pending) if (!handle.cleared) handle.fn()
    },
  }
}

/**
 * A recording client context.
 *
 * @param options - service overrides; each spy is appended to when used.
 * @returns the context plus every recording it produced.
 */
function makeCtx(options = {}) {
  const configWrites = []
  const record = {
    effects: [],
    localeRegistrations: [],
    slotInjections: [],
    slotRegistrations: [],
    fixed: [],
    observers: [],
    commands: [],
    edits: [],
    openSession: [],
    archive: [],
    unarchive: [],
    pin: [],
    unpin: [],
    refresh: [],
    renames: [],
    configWrites: configWrites,
  }

  const pinnedSessionIds = options.pinnedSessionIds ?? []

  // A writable settings scope: tags are stored in the plugin's Config, so the
  // stub has to accept a write and publish it like the real form does — a
  // read-only stub would make "saved" and "dropped" look identical.
  let configStore = { ...(options.configValue ?? {}) }
  const configSubscribers = new Set()
  const configForm = {
    getSnapshot: () => ({ value: configStore, status: 'ready', revision: 'rev-1' }),
    subscribe: (listener) => {
      configSubscribers.add(listener)
      return () => configSubscribers.delete(listener)
    },
    set: (field, value) => {
      configWrites.push({ field, value })
      if (options.refuseWrites === true) return Promise.resolve(false)
      configStore = { ...configStore, [field]: value }
      for (const listener of [...configSubscribers]) listener()
      return Promise.resolve(true)
    },
  }
  const services = {
    sessions: {
      refreshProjections(id) {
        record.refresh.push(id)
        return Promise.resolve()
      },
      // The shape the plugin is allowed to assume: `using` retains, runs the
      // callback, and releases. The rename itself is reached through the retained
      // reference's binding, never through the service directly — a stub that
      // exposed `rename` on the service would let a wrong call site pass.
      using(target, retain, operation) {
        const reference = {
          sessionId: target,
          binding: {
            session: {
              rename: (title) => {
                record.renames.push({ id: target, source: retain?.source, title })
                const outcome = options.renameResult
                return Promise.resolve(
                  typeof outcome === 'function'
                    ? outcome(title)
                    : (outcome ?? { ok: true, value: { title, seq: 1 } }),
                )
              },
            },
          },
        }
        return Promise.resolve(operation(reference))
      },
      // How the shipped header, sidebar and rename command all answer "which
      // session is current" — the plugin reads the same flag.
      list: { getSnapshot: () => options.sessionList ?? { ids: [], byId: {} } },
    },
    workspaces: {
      list: { getSnapshot: () => ({ pinnedSessionIds, archivedSessionIds: [] }) },
      pinSession: (id) => {
        record.pin.push(id)
        return Promise.resolve()
      },
      unpinSession: (id) => {
        record.unpin.push(id)
        return Promise.resolve()
      },
    },
    uiWorkspace: {
      // The plugin pins through the UI-level service because it also maintains
      // the sidebar's manual pin order; the lower-level controller does not.
      pinSession: (id) => {
        record.pin.push(id)
        return Promise.resolve()
      },
      unpinSession: (id) => {
        record.unpin.push(id)
        return Promise.resolve()
      },
      openSession: (id) => record.openSession.push(id),
      archiveSession: (id) => {
        record.archive.push(id)
        return Promise.resolve()
      },
      unarchiveSession: (id) => {
        record.unarchive.push(id)
        return Promise.resolve()
      },
    },
  }

  if (options.withShortcuts !== false) {
    services.shortcuts = {
      platform: options.platform ?? 'macos',
      runtime: 'desktop',
      registerFixed: (command) => {
        record.fixed.push(command)
        return () => record.fixed.push({ disposed: command.id })
      },
      observeFixedInput: (listener) => {
        record.observers.push(listener)
        return () => {}
      },
      register: (command) => {
        record.commands.push(command)
        return () => {}
      },
      edit: (edit, revision) => {
        record.edits.push({ edit, revision })
        return Promise.resolve({ status: 'saved' })
      },
      catalog: {
        getSnapshot: () => options.catalog ?? [{ id: 'session.search', modified: false }],
      },
      config: { getSnapshot: () => ({ revision: options.revision ?? 'rev-1' }) },
    }
  }

  const ctx = {
    effect: (callback, name) => {
      const dispose = callback()
      record.effects.push({ name, dispose: typeof dispose })
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    get: (name) => services[name],
    inject: (deps, callback) => {
      callback(ctx)
      return () => {}
    },
    locale: {
      register: (ns, dicts) => {
        record.localeRegistrations.push({ ns, dicts })
        return () => {}
      },
      // Params are rendered, not dropped: a notice that names the title it stored
      // is a claim worth being able to read back in an assertion.
      bind: () => (key, params) =>
        params === undefined ? key : `${key}(${JSON.stringify(params)})`,
    },
    configForms: { get: () => configForm },
    slots: {
      inject: (key, callback) => {
        record.slotInjections.push(key)
        const dispose = callback()
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      register: (options_, component) => {
        record.slotRegistrations.push({ options: options_, component })
        return () => {}
      },
    },
    sessions: services.sessions,
    uiWorkspace: services.uiWorkspace,
    workspaces: services.workspaces,
  }

  return { ctx, record, services }
}

/** Build one fixed-input event the observer would receive. */
function keyEvent(overrides = {}) {
  const consumed = { value: false }
  return {
    input: {
      type: 'keydown',
      gesture: {
        code: 'KeyK',
        meta: false,
        control: false,
        alt: false,
        shift: false,
        repeat: false,
        ...overrides,
      },
      consume: () => {
        consumed.value = true
      },
    },
    consumed,
  }
}

/** The inject face the slot would hand the component. */
function paletteOf(record) {
  const entry = record.slotRegistrations.find((row) => row.options.id === ROW_ID)
  assert.ok(entry !== undefined, 'the palette entry must be registered')
  return entry.options.inject().palette
}

/**
 * Structural copy across the vm realm boundary.
 *
 * `assert.deepEqual` in strict mode checks prototypes, and an object literal
 * built inside the vm carries the vm realm's `Object.prototype` — so a plain
 * `{}` from the plugin is never deep-strict-equal to a `{}` written here.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

//#endregion

//#region bundle shape

test('registers the package id and requires only react', () => {
  const loaded = loadPlugin()
  assert.equal(loaded.id, NS)
  assert.deepEqual(plain(loaded.plugin.inject), [
    'slots',
    'locale',
    'sessions',
    'uiWorkspace',
    'workspaces',
    'configForms',
  ])
  assert.equal(typeof loaded.plugin.apply, 'function')
})

test('client.js requires react, and only optionally the primitives table', () => {
  const requires = [...clientSource.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((match) => match[1])
  // Two, and the second one is guarded: `MenuItemButton` is a loader external, so
  // a table without it must cost the menu row's styling, never the whole bundle.
  assert.deepEqual(requires, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
  assert.match(
    clientSource,
    /try \{\s*\n\s*const primitives = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/,
    'the primitives lookup is inside a try',
  )
  assert.match(clientSource, /MenuItemButton === null/, 'and there is a fallback path')
  assert.ok(
    !clientSource.includes("from '@deepseek-ai/"),
    'client.js must not import a harness package',
  )
})

test('the instrumented return statement is present exactly once', () => {
  const occurrences = clientSource.split(RETURN_STATEMENT).length - 1
  assert.equal(occurrences, 1, 'the suite instruments this statement; keep it verbatim')
})

//#endregion

//#region id agreement

test('the Loader row id, the browser ROW_ID and the namespace agree', () => {
  const patchId = patchSource.match(/^\s*- id: (\S+)$/m)?.[1]
  assert.equal(patchId, ROW_ID, 'cordis.patch.yml id must equal the browser ROW_ID')
  assert.equal(NS, pkg.name)
  assert.match(clientSource, new RegExp(`const ROW_ID = '${ROW_ID}'`))
})

test('both shortcut command ids satisfy the protocol id pattern', () => {
  assert.match(FIXED_ID, COMMAND_PATTERN)
  assert.match(COMMAND_ID, COMMAND_PATTERN)
  assert.match(clientSource, new RegExp(`const FIXED_ID = '${FIXED_ID.replace('.', '\\.')}'`))
  assert.match(clientSource, new RegExp(`const COMMAND_ID = '${COMMAND_ID.replace('.', '\\.')}'`))
})

//#endregion

//#region host half

test('Config exposes the takeover switch as a volatile boolean, read as text', () => {
  // The host half is read as TEXT, never imported: importing it needs
  // `@deepseek-ai/schemastery`, which on a bare checkout resolves nowhere, so an
  // import here makes the whole suite fail on CI. This is the house pattern.
  assert.match(hostSource, /\.volatile\(\)/, 'volatile() is what makes the field page-writable')
  assert.match(hostSource, /takeOver: z\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(hostSource, /export const Config/)
  assert.match(hostSource, /export function apply/)
  // The plugin writes no shortcut preference, so a second switch would have
  // nothing to configure.
  assert.ok(!hostSource.includes('moveSidebarSearch'))
})

test('the tag store is three volatile fields, because only volatile is page-writable', () => {
  // Tag data is edited from the page and lives in the profile's patch. `.volatile()`
  // is what makes it writable there AND what keeps a write from remounting the
  // plugin (the Loader compares volatile fields out of the update diff), so a
  // field that lost it would either be rejected or close the palette on save.
  for (const field of ['tags', 'assignments']) {
    assert.match(hostSource, new RegExp(`${field}: z\\s*\\n?\\s*\\.array\\(`), `${field} is a list`)
  }
  // Count only code, not the doc sentence that mentions the decorator.
  const declarations = hostSource
    .split('\n')
    .filter((line) => line.includes('.volatile()') && !line.trimStart().startsWith('*'))
  assert.equal(
    declarations.length,
    3,
    'takeOver, tags and assignments — a new field without volatile() is invisible to the page',
  )
  // Identity is the id, not the label: renaming a tag must not orphan assignments.
  assert.match(hostSource, /id: z\.string\(\),\n\s*label: z\.string\(\),/)
  // A flat list, not a map: a schema map would need a key domain for session ids.
  assert.match(hostSource, /sessionId: z\.string\(\),\n\s*tags: z\.array\(z\.string\(\)\),/)
})

test('the package declares the client half the loader gate needs', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'], 'exports["./client"] is required for discovery')
  assert.ok(pkg.dsh.bundle.patch, 'the bundle patch gives the row its home')
})

//#endregion

//#region apply wiring

test('registers both locale dictionaries with identical key sets', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)

  assert.equal(record.localeRegistrations.length, 1)
  const { ns, dicts } = record.localeRegistrations[0]
  assert.equal(ns, NS)
  assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh'])
  const en = Object.keys(dicts.en).sort()
  const zh = Object.keys(dicts.zh).sort()
  assert.ok(en.length > 20, 'expected a real dictionary')
  assert.deepEqual(zh, en, 'zh must cover exactly the en keys')
})

test('appends one marked style tag and removes it on teardown', () => {
  const loaded = loadPlugin()
  const { ctx, record } = makeCtx()
  loaded.plugin.apply(ctx)

  assert.equal(loaded.appended.length, 1)
  const tag = loaded.appended[0]
  assert.equal(tag.textContent.includes('.dsp-card'), true)
  assert.ok(!/!important/.test(tag.textContent), 'no !important in plugin CSS')

  for (const effect of record.effects) {
    if (effect.name === `${NS}: styles`) assert.equal(effect.dispose, 'function')
  }
})

test('registers into shell.overlay through slots.inject, not a bare register', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)

  // Three entries in the overlay, each mounted for a different reason: the palette
  // dialog (⌘K), the action toast (it outlives the palette), and the header title
  // editor (it must render while the palette is closed). The fourth contribution
  // is the sidebar's session-menu row.
  assert.deepEqual(record.slotInjections, [SLOT, SLOT, SLOT, 'sidebar.workspaces.session.menu.item'])
  assert.deepEqual(
    record.slotRegistrations.map((row) => row.options.id).sort(),
    [ROW_ID, `${ROW_ID}.tags`, `${ROW_ID}.title`, `${ROW_ID}.toast`],
  )
  const { options, component } = record.slotRegistrations.find((row) => row.options.id === ROW_ID)
  assert.equal(options.name, SLOT)
  assert.equal(options.id, ROW_ID)
  assert.equal(options.locale, NS)
  assert.equal(typeof options.order, 'number')
  assert.equal(typeof component, 'function')
  assert.deepEqual(Object.keys(options.inject()), ['palette'])
  for (const row of record.slotRegistrations) {
    assert.equal(row.options.locale, NS, `${row.options.id} must localize itself`)
    assert.equal(typeof row.options.inject, 'function')
    assert.deepEqual(Object.keys(row.options.inject()), ['palette'])
  }
})

test('claims the chord with a fixed registration and an observer', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)

  assert.equal(record.fixed.length, 1)
  assert.equal(record.fixed[0].id, FIXED_ID)
  assert.equal(record.fixed[0].group, 'application')
  assert.deepEqual(plain(record.fixed[0].bindings), [{ code: 'KeyK', modifiers: ['primary'] }])
  assert.equal(record.observers.length, 1)
})

test('the companion command is registered with no default binding', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)

  assert.equal(record.commands.length, 1)
  const command = record.commands[0]
  assert.equal(command.id, COMMAND_ID)
  assert.deepEqual(plain(command.defaults), {}, 'a default here would collide at registration')
  assert.ok(command.regions.includes('editable'), 'the chord must work while typing')
  assert.deepEqual(plain(command.modals), [ROW_ID])
  assert.equal(command.resolve().status, 'handled')
})

test('every effect hands back a disposer', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)

  assert.ok(record.effects.length >= 5, `expected several effects, saw ${record.effects.length}`)
  for (const effect of record.effects) {
    assert.equal(effect.dispose, 'function', `effect "${effect.name}" returned no disposer`)
  }
})

//#endregion

//#region hotkey behaviour

test('the primary chord toggles the palette and consumes the gesture', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  const first = keyEvent({ meta: true })
  record.observers[0](first.input)
  assert.equal(first.consumed.value, true, 'the chord must be consumed')
  assert.equal(palette.store.getSnapshot().open, true)

  const second = keyEvent({ meta: true })
  record.observers[0](second.input)
  assert.equal(palette.store.getSnapshot().open, false, 'a second press closes it')
  assert.equal(second.consumed.value, true)
})

test('control is accepted as primary off macOS', () => {
  const { ctx, record } = makeCtx({ platform: 'windows' })
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  const event = keyEvent({ control: true })
  record.observers[0](event.input)
  assert.equal(palette.store.getSnapshot().open, true)
})

test('non-primary chords and repeats are ignored', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  const cases = [
    { shift: true, meta: true },
    { alt: true, meta: true },
    { control: true, meta: true },
    { meta: true, repeat: true },
    {},
  ]
  for (const gesture of cases) {
    const event = keyEvent(gesture)
    record.observers[0](event.input)
    assert.equal(event.consumed.value, false, `should ignore ${JSON.stringify(gesture)}`)
    assert.equal(palette.store.getSnapshot().open, false)
  }

  record.observers[0]({ type: 'reset' })
  assert.equal(palette.store.getSnapshot().open, false)

  const wrongKey = keyEvent({ meta: true })
  wrongKey.input.gesture.code = 'KeyJ'
  record.observers[0](wrongKey.input)
  assert.equal(palette.store.getSnapshot().open, false)
})

//#endregion

//#region configuration

test('takeOver false claims nothing and writes no preference', () => {
  const { ctx, record } = makeCtx({ configValue: { takeOver: false } })
  loadPlugin().plugin.apply(ctx)

  assert.equal(record.fixed.length, 0, 'no fixed binding when opted out')
  assert.equal(record.observers.length, 0)
  assert.equal(record.edits.length, 0)
  assert.equal(record.commands.length, 1, 'the editable companion command still registers')
})

test('the plugin never writes a shortcut preference', () => {
  // The whole point of using a FIXED binding is that the user's keybinding file
  // is untouched, so turning the plugin off restores the shipped default with
  // nothing to undo. Any `edit()` call here would break that.
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  assert.equal(record.fixed.length, 1, 'the chord is still claimed')
  assert.deepEqual(record.edits, [], 'no preference may be written')
})

test('takeOver false claims nothing and writes nothing either', () => {
  const { ctx, record } = makeCtx({ configValue: { takeOver: false } })
  loadPlugin().plugin.apply(ctx)
  assert.equal(record.fixed.length, 0)
  assert.deepEqual(record.edits, [])
})

test('a missing shortcut service degrades instead of throwing', () => {
  const { ctx, record } = makeCtx({ withShortcuts: false })
  loadPlugin().plugin.apply(ctx)

  assert.equal(record.fixed.length, 0)
  assert.equal(record.observers.length, 0)
  assert.ok(record.slotRegistrations.length >= 1, 'the palette still mounts')
})

//#endregion

//#region pure derivation

test('recency buckets break at calendar boundaries', () => {
  const { bucketOf } = loadPlugin().plugin.__internals
  const now = new Date(2026, 9, 11, 15, 30, 0).getTime()
  const midnight = new Date(2026, 9, 11, 0, 0, 0).getTime()

  assert.equal(bucketOf(midnight + 60_000, now), 'today')
  assert.equal(bucketOf(midnight - 60_000, now), 'yesterday')
  assert.equal(bucketOf(midnight - 3 * 86_400_000, now), 'week')
  assert.equal(bucketOf(midnight - 20 * 86_400_000, now), 'month')
  assert.equal(bucketOf(midnight - 200 * 86_400_000, now), 'older')
  assert.equal(bucketOf(Number.NaN, now), 'older')
  assert.equal(bucketOf(undefined, now), 'older')
})

test('elapsed-time labels step at the documented thresholds', () => {
  const { agoParts } = loadPlugin().plugin.__internals
  const now = 1_000_000_000_000
  assert.equal(agoParts(now - 10_000, now).key, 'ago.now')
  assert.deepEqual(plain(agoParts(now - 5 * 60_000, now)), { key: 'ago.min', n: 5 })
  assert.deepEqual(plain(agoParts(now - 3 * 3_600_000, now)), { key: 'ago.hour', n: 3 })
  assert.deepEqual(plain(agoParts(now - 2 * 86_400_000, now)), { key: 'ago.day', n: 2 })
  assert.equal(agoParts(now - 90 * 86_400_000, now).key, 'ago.month')
  assert.equal(agoParts(now - 800 * 86_400_000, now).key, 'ago.year')
})

test('activity tiers order needs-you before running before unread', () => {
  const { tierOf } = loadPlugin().plugin.__internals
  assert.equal(tierOf(false, 'approval', true), 0)
  assert.equal(tierOf(true, undefined, true), 1)
  assert.equal(tierOf(false, undefined, true), 2)
  assert.equal(tierOf(false, undefined, false), 3)
  assert.ok(tierOf(false, 'question', false) < tierOf(true, undefined, false))
})

test('pending kinds map to dictionary keys, unknown ones still count as waiting', () => {
  const { pendingKey, tierOf } = loadPlugin().plugin.__internals
  assert.equal(pendingKey('approval'), 'status.approval')
  assert.equal(pendingKey('plan-review'), 'status.planReview')
  assert.equal(pendingKey('question'), 'status.question')
  // A future interaction kind must not silently demote a blocked session.
  assert.equal(pendingKey('nonsense'), 'status.waiting')
  assert.equal(tierOf(false, 'nonsense', false), 0)
})

test('folder labels handle posix, windows, trailing separators and blanks', () => {
  const { folderLabel } = loadPlugin().plugin.__internals
  assert.equal(folderLabel('/Users/me/work/repo'), 'repo')
  assert.equal(folderLabel('/Users/me/work/repo/'), 'repo')
  assert.equal(folderLabel('C:\\Users\\me\\repo'), 'repo')
  assert.equal(folderLabel(''), '')
  assert.equal(folderLabel(undefined), '')
  assert.equal(folderLabel('/'), '')
})

test('workspace titles are first-writer-wins and fall back to the path', () => {
  const { workspaceTitles } = loadPlugin().plugin.__internals
  const map = workspaceTitles([
    { title: 'Workbench', sessionIds: ['a', 'b'] },
    { title: '', path: '/tmp/named-by-path', sessionIds: ['b', 'c'] },
    { path: '/x/y', sessionIds: ['d'] },
  ])
  assert.equal(map.get('a'), 'Workbench')
  assert.equal(map.get('b'), 'Workbench', 'the first listing owns the session')
  assert.equal(map.get('c'), 'named-by-path')
  assert.equal(map.get('d'), 'y')
})

test('the fuzzy matcher requires an ordered subsequence and ranks prefixes first', () => {
  const { alignmentScore, rankCandidate } = loadPlugin().plugin.__internals
  assert.equal(alignmentScore('session palette', 'sp'), alignmentScore('session palette', 'sp'))
  assert.notEqual(alignmentScore('session palette', 'sp'), undefined)
  assert.equal(alignmentScore('session palette', 'zz'), undefined)
  assert.equal(alignmentScore('abc', 'abcd'), undefined, 'a longer query cannot match')

  const prefix = rankCandidate(['Session palette'], 'sess')
  const infix = rankCandidate(['my session palette'], 'sess')
  assert.ok(prefix.prefix === true)
  assert.equal(infix.prefix, false)
  assert.ok(prefix.score > 0)

  assert.equal(rankCandidate(['abc'], 'xyz'), undefined)
  assert.equal(rankCandidate(['', 'abc'], 'ab').prefix, true)
})

test('dom-safe ids strip characters an attribute selector cannot use', () => {
  const { domSafe } = loadPlugin().plugin.__internals
  assert.equal(domSafe('0f8c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b'), '0f8c1a2b-3d4e-5f60-7a8b-9c0d1e2f3a4b')
  assert.equal(domSafe('a:b.c d'), 'a_b_c_d')
})

test('the store suppresses identical publishes but reports real changes', () => {
  const { createStore } = loadPlugin().plugin.__internals
  const store = createStore({ a: 1, b: 2 })
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  store.set({ a: 1, b: 2 })
  assert.equal(notifications, 0, 'an equal snapshot must not publish')

  store.update((state) => ({ ...state, b: 3 }))
  assert.equal(notifications, 1)
  assert.equal(store.getSnapshot().b, 3)

  store.set(store.getSnapshot())
  assert.equal(notifications, 1, 'the same reference must not publish')
})

//#endregion

//#region preview pipeline

test('projections are requested once, after a dwell, one at a time', async () => {
  const loaded = loadPlugin()
  const { ctx, record } = makeCtx()
  loaded.plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.ensureProjections('session-a')
  palette.ensureProjections('session-a')
  assert.equal(record.refresh.length, 0, 'nothing may fire before the dwell elapses')

  loaded.flushTimers()
  assert.deepEqual(record.refresh, ['session-a'], 'duplicate dwells collapse into one request')
  assert.equal(palette.store.getSnapshot().pendingId, 'session-a')

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(palette.store.getSnapshot().pendingId, null)
  assert.equal(palette.store.getSnapshot().triedId, 'session-a')

  palette.ensureProjections('session-a')
  loaded.flushTimers()
  assert.deepEqual(record.refresh, ['session-a'], 'an already-requested row is never refetched')
})

test('a new dwell target cancels the pending one', () => {
  const loaded = loadPlugin()
  const { ctx, record } = makeCtx()
  loaded.plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.ensureProjections('session-a')
  palette.ensureProjections('session-b')
  loaded.flushTimers()

  assert.deepEqual(record.refresh, ['session-b'], 'only the settled highlight is loaded')
})

test('notify raises a notice and clears it on the timer', () => {
  const loaded = loadPlugin()
  const { ctx, record } = makeCtx()
  loaded.plugin.apply(ctx)
  const palette = paletteOf(record)

  assert.equal(palette.store.getSnapshot().notice, null)
  palette.notify('hello')
  assert.equal(palette.store.getSnapshot().notice.text, 'hello')

  loaded.flushTimers()
  assert.equal(palette.store.getSnapshot().notice, null)
})

test('archiveRow routes to the right workspace call', async () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.archiveRow('s1', false)
  await Promise.resolve()
  assert.deepEqual(record.archive, ['s1'])

  palette.archiveRow('s2', true)
  await Promise.resolve()
  assert.deepEqual(record.unarchive, ['s2'])
})

test('openSession navigates and closes the palette', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.store.update((state) => ({ ...state, open: true }))
  palette.openSession('session-x')

  assert.deepEqual(record.openSession, ['session-x'])
  assert.equal(palette.store.getSnapshot().open, false)
})

//#endregion

//#region row ordering

test('activity leads the unqueried list, ahead of recency', () => {
  const { compareRows } = loadPlugin().plugin.__internals
  const rows = [
    { id: 'idle-new', tier: 3, updatedAt: 500 },
    { id: 'running-old', tier: 1, updatedAt: 100 },
    { id: 'idle-old', tier: 3, updatedAt: 100 },
    { id: 'needs-you', tier: 0, updatedAt: 10 },
  ]
  const sorted = rows
    .slice()
    .sort((left, right) => compareRows(left, right, false))
    .map((row) => row.id)
  assert.deepEqual(sorted, ['needs-you', 'running-old', 'idle-new', 'idle-old'])
})

test('a typed query outranks activity, which then only breaks ties', () => {
  const { compareRows, rankCandidate } = loadPlugin().plugin.__internals
  const needle = 'readme'
  const make = (id, title, tier, updatedAt) => ({
    id,
    tier,
    updatedAt,
    rank: rankCandidate([title], needle),
  })

  const fuzzier = make('running-fuzzy', 'read the migration notes', 1, 900)
  const exact = make('idle-exact', 'README rewrite', 3, 100)
  assert.notEqual(fuzzier.rank, undefined, 'the fuzzy row must match, or the case proves nothing')
  assert.equal(exact.rank.prefix, true)

  const sorted = [fuzzier, exact]
    .slice()
    .sort((left, right) => compareRows(left, right, true))
    .map((row) => row.id)
  assert.equal(sorted[0], 'idle-exact', 'the better match wins even though it is idle')

  const tied = [make('idle', 'readme', 3, 900), make('running', 'readme', 1, 100)]
  const tiedSorted = tied
    .slice()
    .sort((left, right) => compareRows(left, right, true))
    .map((row) => row.id)
  assert.equal(tiedSorted[0], 'running', 'at equal quality, activity decides')
})

//#endregion

//#region pinning

test('the recency view ignores pins entirely', () => {
  const { compareRows } = loadPlugin().plugin.__internals
  const pinnedStale = { id: 'pinned-stale', tier: 3, pinned: true, pinIndex: 0, updatedAt: 1 }
  const fresh = { id: 'fresh', tier: 3, pinned: false, pinIndex: 99, updatedAt: 1_000_000 }
  const running = { id: 'running', tier: 1, pinned: false, pinIndex: 99, updatedAt: 1 }
  const sorted = [pinnedStale, fresh, running]
    .sort((left, right) => compareRows(left, right, false))
    .map((row) => row.id)
  // The drawer is a separate view, so a pin neither lifts a stale session above
  // fresh ones nor demotes it: it only changes where you can find it.
  assert.deepEqual(sorted, ['running', 'fresh', 'pinned-stale'])
})

test('a pin gets no search bonus either', () => {
  const { compareRows, rankCandidate } = loadPlugin().plugin.__internals
  const needle = 'alpha'
  const rank = rankCandidate(['alpha notes'], needle)
  const pinnedOlder = { id: 'pinned', tier: 3, pinned: true, pinIndex: 0, updatedAt: 5, rank }
  const plainNewer = { id: 'plain', tier: 3, pinned: false, pinIndex: 9, updatedAt: 900, rank }
  const sorted = [pinnedOlder, plainNewer]
    .sort((left, right) => compareRows(left, right, true))
    .map((row) => row.id)
  assert.deepEqual(sorted, ['plain', 'pinned'], 'equal match quality, so recency decides')
})

test('the drawer follows pin order, most recently pinned first', () => {
  const { comparePinned } = loadPlugin().plugin.__internals
  const rows = [
    { id: 'long-ago', pinIndex: 4, updatedAt: 999 },
    { id: 'just-now', pinIndex: 0, updatedAt: 10 },
    { id: 'middle', pinIndex: 2, updatedAt: 500 },
  ]
  const sorted = rows
    .slice()
    .sort((left, right) => comparePinned(left, right))
    .map((row) => row.id)
  // Pin order, not the clock: the drawer answers "what did I last keep?".
  assert.deepEqual(sorted, ['just-now', 'middle', 'long-ago'])
})

test('togglePin calls the matching workspace RPC', async () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.togglePin('s1', false)
  await Promise.resolve()
  assert.deepEqual(record.pin, ['s1'])
  assert.deepEqual(record.unpin, [])

  palette.togglePin('s2', true)
  await Promise.resolve()
  assert.deepEqual(record.unpin, ['s2'])
  assert.deepEqual(record.pin, ['s1'])
})

test('archiving a pinned session reports that the pin went with it', async () => {
  const { ctx, record } = makeCtx({ pinnedSessionIds: ['s1'] })
  loadPlugin().plugin.apply(ctx)
  const palette = paletteOf(record)

  palette.archiveRow('s1', false)
  await Promise.resolve()
  assert.equal(palette.store.getSnapshot().notice.text, 'archived.droppedPin')

  palette.archiveRow('s2', false)
  await Promise.resolve()
  assert.equal(palette.store.getSnapshot().notice.text, 'archived.done')
})

test('every drawer string exists in both dictionaries', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const { dicts } = record.localeRegistrations[0]
  for (const key of [
    'view.recents',
    'view.pinned',
    'view.hint',
    'pinned.empty',
    'pinned.emptyHint',
    'pinned.emptyMatch',
    'preview.youNow',
    'pin.done',
    'unpin.done',
    'pin.failed',
    'archived.droppedPin',
  ]) {
    assert.ok(dicts.en[key], `en is missing ${key}`)
    assert.ok(dicts.zh[key], `zh is missing ${key}`)
  }
  assert.ok(!('group.pinned' in dicts.en), 'the shelf label is gone with the shelf')
  const footer = dicts.en['preview.footer']
  assert.ok(footer.includes('tab'), 'the footer must advertise the drawer')
  assert.ok(footer.includes('⇧P'), 'the footer must advertise the pin chord')
  assert.ok(dicts.zh['preview.footer'].includes('tab'))
  assert.ok(dicts.zh['preview.footer'].includes('⇧P'))
})

//#endregion


//#region browse-list accounting

test('the browse list classifies everything the sidebar hides', () => {
  const { classify } = loadPlugin().plugin.__internals
  assert.equal(classify({}, false), 'listed')
  assert.equal(classify({ blank: true }, false), 'blank')
  assert.equal(classify({ origin: 'subagent' }, false), 'subagent')
  assert.equal(classify({}, true), 'archived')
  // Precedence is deliberate: a placeholder is a placeholder, and a subagent run
  // is reported as a subagent run even when it is also archived — neither is a
  // conversation the reader could open.
  assert.equal(classify({ blank: true, origin: 'subagent' }, true), 'blank')
  assert.equal(classify({ origin: 'subagent' }, true), 'subagent')
})

test('the footer count is the browse list, not the raw store size', () => {
  // `ids.length` counts rows the user can never see, so the count must come from
  // the classification instead. This is the regression guard for "1531 sessions".
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  assert.ok(!/count: ids\.length/.test(source), 'the footer must not report the raw store size')
  assert.equal((source.match(/count: listed,/g) ?? []).length, 2, 'both views report it')
  assert.ok(source.includes("t('palette.subagentHidden'"), 'the gap must be explained')
})

//#endregion

//#region the archive view

test('the view ring cycles recents, pinned and archived', () => {
  const ring = clientSource.match(/const VIEWS = \[([^\]]+)\]/)
  assert.ok(ring !== null, 'VIEWS must exist')
  assert.deepEqual(
    ring[1].split(',').map((part) => part.trim().replace(/'/g, '')),
    ['recents', 'pinned', 'archived'],
  )
  // With three views Tab must cycle, not toggle.
  assert.match(clientSource, /VIEWS\[\(index \+ step \+ VIEWS\.length\) % VIEWS\.length\]/)
  assert.match(clientSource, /const step = event\.shiftKey \? -1 : 1/, '⇧Tab walks backwards')
})

test('the archive view carries its own strings in both locales', () => {
  const { ctx, record } = makeCtx()
  loadPlugin().plugin.apply(ctx)
  const { dicts } = record.localeRegistrations[0]
  for (const key of [
    'view.archived',
    'archived.empty',
    'archived.emptyMatch',
    'archived.emptyHint',
    'archived.restoreHint',
    'pin.archived',
    'notice.undo',
    'status.archived',
    'archived.open',
  ]) {
    assert.ok(dicts.en[key], `en is missing ${key}`)
    assert.ok(dicts.zh[key], `zh is missing ${key}`)
  }
})

test('the archived count lives only in the drawer, not in the footer', () => {
  // The drawer tab already reads "Archived N", so a footer copy is duplication —
  // and it was also the thing that had to special-case itself while the drawer
  // was open.
  assert.ok(!clientSource.includes("t('palette.archivedHidden'"), 'not rendered anywhere')
  assert.ok(!clientSource.includes("'palette.archivedHidden'"), 'and the key is gone too')
  assert.match(clientSource, /t\('view\.archived', \{ n: model\.archivedTotal \}\)/)
})

test('an archived row is dimmed and says it cannot be opened', () => {
  assert.match(clientSource, /dsp-rowdim/, 'archived rows must be visually set apart')
  assert.match(
    clientSource,
    /activeRow\.archived\s*\n?\s*\? t\('archived\.restoreHint'\)/,
    'the preview must explain the restriction rather than looking empty',
  )
  // The Enter guard has to fire before navigation, because openSession itself
  // performs no archive check.
  const activate = clientSource.slice(
    clientSource.indexOf('const activate = React.useCallback'),
    clientSource.indexOf('const onKeyDown = React.useCallback'),
  )
  assert.ok(activate.includes("t('archived.open')"), 'Enter on an archived row must refuse')
  assert.ok(
    activate.indexOf("t('archived.open')") < activate.indexOf('palette.openSession'),
    'the refusal must come first',
  )
})

//#endregion

//#region rendered behaviour
//
// Everything below drives the REAL component through a settled hook runtime.
// Before this region existed the component was never invoked anywhere, so view
// switching, grouping, the archive guard, the footer counts, row dimming, the
// chord handlers and the toast were all browser-verified only — and a mutation
// battery showed the suite stayed green with the component replaced by a `throw`.

/** One synthetic keyboard event for the card's handler. */
function press(key, modifiers = {}) {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    repeat: false,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.propagationStopped = true
    },
    ...modifiers,
  }
}

/** Apply + mount + open in one step. */
function paletteUi(options = {}) {
  const loaded = loadPlugin()
  const made = makeCtx(options.ctx)
  loaded.plugin.apply(made.ctx)
  const ui = mount(loaded, made.record, options)
  ui.palette.store.update((state) => ({ ...state, open: true, epoch: 1 }))
  ui.render()
  return { loaded, ...made, ui }
}

test('an archived row is dimmed, refuses to open, and explains itself', () => {
  const { record, ui } = paletteUi({
    sessions: sessionsOf([{ id: 'live', title: 'Live' }, { id: 'old', title: 'Put away' }]),
    workspaces: { archivedSessionIds: ['old'] },
  })

  // Recents lists the live row and must not contain the archived one.
  const recents = ui.all('dsp-row')
  assert.equal(recents.length, 1, 'recents lists exactly the live session')
  assert.deepEqual(rowTitles(ui), ['Live'])

  ui.find('dsp-card').props.onKeyDown(press('Tab', { shiftKey: true })) // backwards -> archived
  const row = ui.find('dsp-row')
  assert.ok(row !== null, 'the archived drawer shows it')
  assert.match(row.props.className, /dsp-rowdim/, 'and dims it')

  // Re-read the handler from the SETTLED tree; the earlier tree's closures hold
  // the earlier state.
  ui.find('dsp-row').props.onClick()
  assert.deepEqual(record.openSession, [], 'an archived session must not open')
  assert.equal(ui.palette.store.getSnapshot().notice.text, 'archived.open')
})

test('the footer reports the browse list, not the raw store', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([
      { id: 'a', title: 'Real one' },
      { id: 'sub', title: 'Subagent run', origin: 'subagent' },
      { id: 'blank', title: 'New session', blank: true },
      { id: 'old', title: 'Put away' },
    ]),
    workspaces: { archivedSessionIds: ['old'] },
  })
  const footer = ui.find('dsp-footer').children[0].children
    .map((child) => (typeof child === 'string' ? child : ''))
    .filter(Boolean)
    .join(' ')
  assert.match(footer, /palette\.count\(\{"n":1\}\)/, 'the browse count is 1, not the raw 4')
  assert.match(footer, /palette\.subagentHidden\(\{"n":1\}\)/, 'the subagent run is explained')
  assert.ok(!footer.includes('archivedHidden'), 'the drawer carries the archived count instead')
})

test('the pinned badge counts pins the query does not match', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'p', title: 'Pinned thing' }, { id: 'x', title: 'Other' }]),
    workspaces: { pinnedSessionIds: ['p'] },
  })
  const label = () => {
    const button = ui.all('dsp-view')[1]
    return button.children.join('')
  }
  assert.match(label(), /view\.pinned\(\{"n":1\}\)/, 'the badge carries the live pin count')

  const input = ui.find('dsp-input')
  input.props.onChange({ target: { value: 'zzzz' } })
  assert.equal(ui.find('dsp-row'), null, 'the query matches nothing')
  // The whole point of the drawer is the reminder that something is in it, so the
  // badge must survive a query that excludes every pinned row.
  assert.match(label(), /view\.pinned\(\{"n":1\}\)/, 'the badge STILL reports 1 after a query')
})

test('Tab cycles the view ring and ⇧Tab walks it back', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'A' }]),
  })
  const pressed = () => ui.all('dsp-view').findIndex((n) => n.props['aria-pressed'] === 'true')
  assert.equal(pressed(), 0, 'recents')
  ui.find('dsp-card').props.onKeyDown(press('Tab'))
  assert.equal(pressed(), 1, 'pinned')
  ui.find('dsp-card').props.onKeyDown(press('Tab'))
  assert.equal(pressed(), 2, 'archived')
  ui.find('dsp-card').props.onKeyDown(press('Tab'))
  assert.equal(pressed(), 0, 'wraps to recents')
  ui.find('dsp-card').props.onKeyDown(press('Tab', { shiftKey: true }))
  assert.equal(pressed(), 2, '⇧Tab goes backwards')
})

test('⌘⇧⌫ archives the highlighted row, and restores it from the drawer', async () => {
  const { record, ui } = paletteUi({
    sessions: sessionsOf([{ id: 'live', title: 'Live' }, { id: 'old', title: 'Put away' }]),
    workspaces: { archivedSessionIds: ['old'] },
  })
  const chord = press('Backspace', { shiftKey: true, metaKey: true })

  ui.find('dsp-card').props.onKeyDown(chord)
  assert.deepEqual(record.archive, ['live'], 'the HIGHLIGHTED row, not the open one')
  assert.equal(chord.defaultPrevented, true)
  // The notice arrives from the RPC's `.then`, so it needs a tick.
  await Promise.resolve()
  await Promise.resolve()
  assert.match(ui.palette.store.getSnapshot().notice.text, /archived\.done/)

  // And from the drawer the same chord restores.
  ui.find('dsp-card').props.onKeyDown(press('Tab', { shiftKey: true }))
  ui.find('dsp-card').props.onKeyDown(press('Backspace', { shiftKey: true, metaKey: true }))
  await Promise.resolve()
  assert.deepEqual(record.unarchive, ['old'])
})

test('a row click does not steal focus from the dialog', () => {
  const { ui } = paletteUi({ sessions: sessionsOf([{ id: 'a', title: 'A' }]) })
  const row = ui.find('dsp-row')
  const event = press('mousedown')
  row.props.onMouseDown(event)
  // Without this the click moves focus to <body> and every shortcut dies, on a
  // path that deliberately keeps the palette open.
  assert.equal(event.defaultPrevented, true)
})

test('the list is capped and says so', () => {
  const many = Array.from({ length: 260 }, (_, index) => ({
    id: `s${index}`,
    title: `Session ${index}`,
    updatedAt: 1_000_000 - index,
  }))
  const { ui } = paletteUi({ sessions: sessionsOf(many) })
  assert.equal(ui.all('dsp-row').length, 200, 'ROW_LIMIT caps the rendered rows')
  assert.match(ui.find('dsp-footer').children[0].children.map((c) => String(c ?? '')).join(' '), /palette\.truncated/)
})

test('the toast outlives the palette and offers a working Undo', () => {
  const { loaded, record } = (() => {
    const l = loadPlugin()
    const m = makeCtx()
    l.plugin.apply(m.ctx)
    return { loaded: l, record: m.record }
  })()
  const ui = mount(loaded, record, { entryId: `${ROW_ID}.toast` })

  assert.equal(ui.render(), null, 'nothing until there is something to say')

  let undone = 0
  ui.palette.notify('archived.done', () => {
    undone += 1
  })
  const toast = ui.find('dsp-toast')
  assert.ok(toast !== null, 'the toast renders outside the palette card')
  assert.equal(toast.props.role, 'status', 'and is announced politely')

  ui.find('dsp-toastbtn').props.onClick()
  assert.equal(undone, 1, 'Undo runs the inverse action')
  assert.equal(ui.render(), null, 'and dismisses the toast')
})

//#endregion



//#region last-turn loading

test('an in-flight refresh does not hide a turn that is already loaded', () => {
  const { ui } = paletteUi({
    sessions: {
      ids: ['a'],
      byId: { a: { displayTitle: 'A', updatedAt: 1000, blank: false, running: false } },
      phase: 'ready',
      projectionsBySession: {
        a: { values: { turnOutline: [{ turn: 1, prompt: 'PROMPT_TEXT', response: 'RESPONSE_TEXT' }] } },
      },
    },
  })
  // Pretend a refresh is in flight for the row we are looking at. With the old
  // `pendingId`-only test this hid the turn text behind a shimmer.
  ui.palette.store.update((state) => ({ ...state, pendingId: 'a' }))
  const strings = ui
    .nodes()
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))

  assert.ok(strings.includes('PROMPT_TEXT'), 'the loaded turn is rendered')
  assert.ok(!strings.includes('preview.loading'), 'and no placeholder covers it')
})

test('a null row does not take the whole slot entry down', () => {
  const { ui } = paletteUi({
    sessions: {
      ids: ['broken', 'fine'],
      byId: {
        broken: null,
        fine: { displayTitle: 'Fine', updatedAt: 5, blank: false, running: false },
      },
      phase: 'ready',
      projectionsBySession: {},
    },
  })
  assert.deepEqual(rowTitles(ui), ['Fine'], 'the good row still renders')
})

test('reopening does not greet you with the last action\'s message', () => {
  const { ui } = paletteUi({ sessions: sessionsOf([{ id: 'a', title: 'A' }]) })
  ui.palette.notify('archived.done')
  assert.equal(ui.palette.store.getSnapshot().notice.text, 'archived.done')

  // Close and reopen, the way ⌘K ⌘K does.
  ui.palette.close()
  ui.render()
  ui.palette.store.update((state) => ({ ...state, open: true, epoch: 2 }))
  ui.render()
  assert.equal(ui.palette.store.getSnapshot().notice, null, 'no stale toast on reopen')
})

//#endregion

//#region rename
//
// `⌘⇧R` reuses the search field as a title editor. These tests cover the part
// the browser cannot be trusted to prove on its own: what the field claims to be
// (combobox vs textbox), which draft is sent, through which service, and what
// happens when the host refuses.

/** Open the palette over `rows` and press the rename chord. */
function startRenameUi(rows, ctx = {}) {
  const made = paletteUi({ sessions: sessionsOf(rows), ctx })
  const chord = press('r', { shiftKey: true, metaKey: true })
  made.ui.find('dsp-card').props.onKeyDown(chord)
  return { ...made, chord }
}

/**
 * The visible title text of every rendered session row.
 *
 * The title is a `<span>` inside `dsp-rowtitle` because the tag glyphs sit beside
 * it — reading the container's children as strings stopped being meaningful the
 * moment tags could follow a title.
 */
const rowTitles = (ui) =>
  ui
    .all('dsp-rowtitle')
    .map((node) => node.children.find((child) => child?.props?.className === 'dsp-rowtitletext'))
    .map((node) => (node === undefined ? null : node.children.filter((c) => typeof c === 'string').join('')))

/** The ids of the rows currently published as selected. */
const selectedIds = (ui) =>
  ui
    .all('dsp-row')
    .filter((node) => node.props['aria-selected'] === 'true')
    .map((node) => String(node.props.id).replace(/^dsp-opt-/, ''))

test('⌘⇧R turns the search field into a title editor, without adding a field', () => {
  const { ui, chord } = startRenameUi([
    { id: 'a', title: 'Old name' },
    { id: 'b', title: 'Other' },
  ])

  assert.equal(chord.defaultPrevented, true, 'the chord is claimed from the browser')
  // The design decision, asserted: one input, two jobs. A second text box would
  // have to fight the row's focus handling and hide itself from the a11y tree.
  assert.equal(ui.all('dsp-input').length, 1)

  const field = ui.find('dsp-input')
  assert.equal(field.props.role, 'textbox', 'no longer a combobox: the list is not driven')
  assert.equal(field.props['aria-expanded'], undefined, 'and claims no expanded list')
  assert.equal(field.props['aria-activedescendant'], undefined)
  assert.equal(field.props.value, 'Old name', 'seeded with the title being renamed')
  assert.equal(field.props.placeholder, 'rename.placeholder')
  assert.equal(field.props['aria-label'], 'rename.aria')

  const hint = ui.find('dsp-keyhint')
  assert.deepEqual(hint.children, ['rename.hint'], 'the trailing chip teaches the two keys')
  assert.match(ui.find('dsp-inputrow').props.className, /dsp-inputrow-renaming/)
  assert.deepEqual(selectedIds(ui), ['a'], 'the highlight still says which row this is')
})

test('an untitled session seeds an empty draft, not its folder fallback', () => {
  // A raw snapshot, because `sessionsOf` derives `displayTitle` from the id. Here
  // the displayed title is the folder, which is exactly the fallback that must
  // not become the draft.
  const made = paletteUi({
    sessions: {
      ids: ['a'],
      byId: {
        a: {
          displayTitle: 'project',
          updatedAt: 1_000,
          blank: false,
          running: false,
          cwd: '/Users/me/project',
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    },
  })
  made.ui.find('dsp-card').props.onKeyDown(press('r', { shiftKey: true, metaKey: true }))

  // Seeding that fallback would turn derived text into user data the moment the
  // user pressed Enter unchanged.
  assert.deepEqual(rowTitles(made.ui), ['project'])
  assert.equal(made.ui.find('dsp-input').props.value, '')
})

test('Enter renames through sessions.using and reports what the host stored', async () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old name' }])
  ui.find('dsp-input').props.onChange({ target: { value: '  New name  ' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(record.renames, [
    { id: 'a', source: 'sessionPalette', title: 'New name' },
  ])
  // The draft is trimmed here; the retain is attributed to this plugin so a
  // diagnostic dump can tell it from the host's own retains.
  assert.match(ui.palette.store.getSnapshot().notice.text, /rename\.done/)
  assert.equal(ui.find('dsp-input').props.role, 'combobox', 'the field is a search box again')
  assert.equal(ui.find('dsp-input').props.value, '', 'and shows the query it interrupted')
})

test('the toast reports the accepted title, not the draft', async () => {
  // The host shortens a title past its byte budget. Showing the draft would claim
  // a rename that did not happen.
  const { ui } = startRenameUi([{ id: 'a', title: 'Old' }], {
    renameResult: (title) => ({ ok: true, value: { title: `${title}…`, seq: 2 } }),
  })
  ui.find('dsp-input').props.onChange({ target: { value: 'A very long title' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  assert.match(
    ui.palette.store.getSnapshot().notice.text,
    /A very long title…/,
    'the host answer is what the user is told',
  )
})

test('a rejected rename keeps the draft and shows the reason', async () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old' }], {
    renameResult: () => ({ ok: false, error: { message: 'session/title-invalid' } }),
  })
  ui.find('dsp-input').props.onChange({ target: { value: 'Nope' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(record.renames.length, 1, 'the attempt reached the host')
  const field = ui.find('dsp-input')
  assert.equal(field.props.role, 'textbox', 'the editor stays open')
  assert.equal(field.props.value, 'Nope', 'with the draft intact, ready for a retry')
  const error = ui.find('dsp-renameerror')
  assert.equal(error.props.role, 'alert', 'and the reason is announced')
  assert.match(error.children[0], /rename\.failed/)
  assert.match(error.children[0], /session\/title-invalid/)

  // Typing again clears the stale reason: it described the previous draft.
  ui.find('dsp-input').props.onChange({ target: { value: 'Nope2' } })
  assert.equal(ui.find('dsp-renameerror'), null)
})

test('a failed retain is reported instead of swallowing the click', async () => {
  const { ui } = startRenameUi([{ id: 'a', title: 'Old' }], {
    renameResult: () => {
      throw new Error('Session Controller is disposed')
    },
  })
  ui.find('dsp-input').props.onChange({ target: { value: 'New' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  // A throw from `using` is a rejected promise, so it lands on the same path.
  assert.match(ui.find('dsp-renameerror').children[0], /rename\.failed/)
})

test('Escape abandons the draft without a request and keeps the palette open', () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old' }])
  ui.find('dsp-input').props.onChange({ target: { value: 'Discard me' } })
  const escape = press('Escape')
  ui.find('dsp-card').props.onKeyDown(escape)

  assert.equal(escape.defaultPrevented, true, 'the document Escape arbiter must stand down')
  assert.equal(escape.propagationStopped, true)
  assert.deepEqual(record.renames, [])
  assert.equal(ui.palette.store.getSnapshot().open, true, 'the palette itself stays up')
  assert.equal(ui.find('dsp-input').props.role, 'combobox')
})

test('an empty or unchanged draft never reaches the host', () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Same' }])

  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  assert.deepEqual(record.renames, [], 'an unchanged title is not a write')
  assert.equal(ui.find('dsp-input').props.role, 'combobox', 'and the editor closes')

  ui.find('dsp-card').props.onKeyDown(press('r', { shiftKey: true, metaKey: true }))
  ui.find('dsp-input').props.onChange({ target: { value: '   ' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  assert.deepEqual(record.renames, [], 'the host rejects an empty title; do not ask it to')
  assert.equal(ui.find('dsp-input').props.role, 'textbox', 'the editor stays open')
})

test('an IME candidate owns Enter, and saving resumes after composition', () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old' }])
  ui.find('dsp-input').props.onChange({ target: { value: '新名字' } })
  ui.find('dsp-input').props.onCompositionStart()
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  assert.deepEqual(record.renames, [], 'committing mid-composition would save half a word')

  ui.find('dsp-input').props.onCompositionEnd()
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  assert.equal(record.renames.length, 1, 'and Enter saves once composition ends')
  assert.equal(record.renames[0].title, '新名字')
})

test('while editing, the arrows and Tab belong to the text field again', () => {
  const { ui } = startRenameUi([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
  assert.deepEqual(selectedIds(ui), ['a'])

  const down = press('ArrowDown')
  ui.find('dsp-card').props.onKeyDown(down)
  assert.equal(down.defaultPrevented, false, 'the caret keeps the arrow')
  assert.deepEqual(selectedIds(ui), ['a'], 'the list does not move under the editor')

  const tab = press('Tab')
  ui.find('dsp-card').props.onKeyDown(tab)
  assert.equal(tab.defaultPrevented, false, 'and Tab is not stolen by the view ring')
  assert.deepEqual(selectedIds(ui), ['a'])
})

test('a rename that is in flight ignores Enter and Escape until it settles', async () => {
  let release
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old' }], {
    renameResult: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, value: { title: 'New', seq: 3 } })
    }),
  })
  ui.find('dsp-input').props.onChange({ target: { value: 'New' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()

  assert.equal(ui.find('dsp-input').props.readOnly, true, 'the draft is frozen, not disabled')
  assert.equal(ui.find('dsp-input').props['aria-busy'], 'true')

  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  ui.find('dsp-card').props.onKeyDown(press('Escape'))
  assert.equal(record.renames.length, 1, 'one request, and Escape did not abandon it')

  release()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(ui.find('dsp-input').props.role, 'combobox', 'and the editor closes on success')
})

test('a rename offers Undo, which renames back through the same path', async () => {
  const { ui, record } = startRenameUi([{ id: 'a', title: 'Old' }])
  ui.find('dsp-input').props.onChange({ target: { value: 'New' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  const notice = ui.palette.store.getSnapshot().notice
  assert.ok(typeof notice.undo === 'function', 'a rename is reversible')

  notice.undo()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(record.renames[1], {
    id: 'a',
    source: 'sessionPalette',
    title: 'Old',
  })
  assert.match(ui.palette.store.getSnapshot().notice.text, /rename\.done/)
})

test('an untitled session gets no Undo that would blank its title', async () => {
  const { ui } = startRenameUi([{ id: 'a', cwd: '/Users/me/project' }])
  ui.find('dsp-input').props.onChange({ target: { value: 'Named' } })
  ui.find('dsp-card').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  // Undo would submit '', which the host refuses: offering it would promise a
  // restore that cannot happen.
  assert.equal(ui.palette.store.getSnapshot().notice.undo, undefined)
})

test('reopening the palette does not resume an abandoned rename', () => {
  const { ui } = startRenameUi([{ id: 'a', title: 'A' }])
  ui.palette.close()
  ui.render()
  ui.palette.store.update((state) => ({ ...state, open: true, epoch: 2 }))
  assert.equal(ui.find('dsp-input').props.role, 'combobox')
})

test('the rename chord leaves the host its own chords', () => {
  const { ui } = paletteUi({ sessions: sessionsOf([{ id: 'a', title: 'A' }]) })

  // ⌘R is `page.refresh` and ⌘⌥G is `session.rename`: both are intercepted
  // natively before the page sees them, so claiming either would mean the
  // handler never runs and the host acts behind the palette instead.
  for (const chord of [press('r', { metaKey: true }), press('g', { metaKey: true, altKey: true })]) {
    ui.find('dsp-card').props.onKeyDown(chord)
    assert.equal(chord.defaultPrevented, false, `${chord.key} stays the host's`)
  }
  assert.equal(ui.find('dsp-input').props.role, 'combobox', 'no editor opened')

  // And with nothing highlighted the chord is a no-op rather than a crash.
  const empty = paletteUi({ sessions: sessionsOf([]) })
  empty.ui.find('dsp-card').props.onKeyDown(press('r', { shiftKey: true, metaKey: true }))
  assert.equal(empty.ui.find('dsp-input').props.role, 'combobox')
})

//#endregion

//#region header title editor
//
// The second surface: double-clicking the conversation header's title. It floats
// an input over the shipped `crumbCurrent` span rather than replacing any shipped
// UI, so these tests cover the box it takes, the guards that keep it from racing
// the sidebar's own double click, and the shared write path.

/** A session list snapshot with one Session held by the main view. */
function mainSession(id, title) {
  return { ids: [id], byId: { [id]: { id, title, retainedBy: { mainView: 1 } } } }
}

/** A stand-in for the header's title span. */
const TITLE_SPAN = { getBoundingClientRect: () => ({ left: 300, top: 40, width: 180, height: 28 }) }

/** Mount the title-editor entry (it renders nothing until a double click). */
function headerUi(options = {}) {
  const loaded = loadPlugin()
  const made = makeCtx(options.ctx)
  loaded.plugin.apply(made.ctx)
  const ui = mount(loaded, made.record, { entryId: `${ROW_ID}.title` })
  return { loaded, ui, ...made }
}

/**
 * Fire the document-level double click the component listens for.
 *
 * @param span - the element `closest()` should resolve, or null for "not the title".
 */
function doubleClick({ loaded, ui }, span) {
  // The listener is attached by an effect, so the component has to have rendered.
  ui.render()
  const event = press('dblclick', {
    target: {
      closest: (selector) =>
        span !== null && selector === '[class*="crumbCurrent"]' ? span : null,
    },
  })
  for (const listener of loaded.listeners.dblclick ?? []) listener(event)
  return event
}

test('double-clicking the header title opens an editor over that exact box', () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'DSH 插件开发') } })
  assert.equal(made.ui.render(), null, 'nothing until the gesture')

  const event = doubleClick(made, TITLE_SPAN)
  assert.equal(event.defaultPrevented, true, 'the gesture is ours')

  const field = made.ui.find('dsp-title-edit')
  assert.ok(field !== null, 'an input appears')
  assert.equal(field.props.value, 'DSH 插件开发', 'seeded with the stored title')
  assert.equal(field.props['aria-label'], 'rename.aria')
  assert.deepEqual(
    plain(field.props.style),
    // 180px wide is the shipped crumb's max; the editor opens at a usable width
    // and keeps the span's height so the text sits where the title was.
    { left: '300px', top: '40px', width: '260px', height: '28px' },
  )
})

test('a double click that is not the header title is left alone', () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'Title') } })
  // A sidebar row: the host already opens its own rename dialog on a double
  // click, and a second handler here would race it.
  const event = doubleClick(made, null)
  assert.equal(event.defaultPrevented, false)
  assert.equal(made.ui.render(), null)
})

test('the editor needs a current session, not just a title-looking element', () => {
  // `crumbCurrent` is also the placeholder rendered when nothing is selected, so
  // the span alone must not be enough: no main-view retain means no editor.
  const made = headerUi({
    ctx: { sessionList: { ids: ['a'], byId: { a: { title: 'X', retainedBy: { workspaceOperation: 1 } } } } },
  })
  doubleClick(made, TITLE_SPAN)
  assert.equal(made.ui.render(), null)
})

test('Enter writes through the same retain path and closes the editor', async () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'Old') } })
  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onChange({ target: { value: '  New  ' } })
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(made.record.renames, [{ id: 'a', source: 'sessionPalette', title: 'New' }])
  assert.equal(made.ui.find('dsp-title-edit'), null, 'the editor is gone')
  assert.match(made.ui.palette.store.getSnapshot().notice.text, /rename\.done/)
  // The toast is the palette's, so it renders in its own entry — and it offers
  // Undo because there was a title to restore.
  assert.ok(typeof made.ui.palette.store.getSnapshot().notice.undo === 'function')
})

test('Escape and blur both abandon the draft without a request', () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'Old') } })

  doubleClick(made, TITLE_SPAN)
  const escape = press('Escape')
  made.ui.find('dsp-title-edit').props.onKeyDown(escape)
  assert.equal(escape.defaultPrevented, true)
  assert.equal(escape.propagationStopped, true)
  assert.equal(made.ui.find('dsp-title-edit'), null)

  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onBlur()
  assert.equal(made.ui.find('dsp-title-edit'), null, 'clicking away is a cancel, not a save')
  assert.deepEqual(made.record.renames, [])
})

test('an unchanged or blank draft never reaches the host', () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'Same') } })

  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  assert.deepEqual(made.record.renames, [], 'an unchanged title is not a write')
  assert.equal(made.ui.find('dsp-title-edit'), null)

  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onChange({ target: { value: '   ' } })
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  assert.deepEqual(made.record.renames, [], 'the host rejects an empty title; do not ask')
  assert.ok(made.ui.find('dsp-title-edit') !== null, 'and the editor stays open')
})

test('a rejected rename keeps the box open with the reason under it', async () => {
  const made = headerUi({
    ctx: {
      sessionList: mainSession('a', 'Old'),
      renameResult: () => ({ ok: false, error: { message: 'session/title-invalid' } }),
    },
  })
  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onChange({ target: { value: 'Nope' } })
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  await Promise.resolve()

  const field = made.ui.find('dsp-title-edit')
  assert.equal(field.props.value, 'Nope', 'the draft survives')
  const error = made.ui.find('dsp-title-error')
  assert.equal(error.props.role, 'alert')
  assert.match(error.children[0], /session\/title-invalid/)
  // The bubble sits under the box, not somewhere else on the screen.
  assert.equal(plain(error.props.style).top, '72px')
})

test('IME composition owns Enter in the header editor too', () => {
  const made = headerUi({ ctx: { sessionList: mainSession('a', 'Old') } })
  doubleClick(made, TITLE_SPAN)
  made.ui.find('dsp-title-edit').props.onChange({ target: { value: '新名字' } })
  made.ui.find('dsp-title-edit').props.onCompositionStart()
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  assert.deepEqual(made.record.renames, [], 'committing mid-composition saves half a word')

  made.ui.find('dsp-title-edit').props.onCompositionEnd()
  made.ui.find('dsp-title-edit').props.onKeyDown(press('Enter'))
  assert.equal(made.record.renames.length, 1)
})

//#endregion

//#region directory search

test('a query finds a Session by a directory on its path, not just by its title', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([
      { id: 'a', title: 'Build the thing', cwd: '/Users/me/workspace/test-dsh/palette' },
      { id: 'b', title: 'Unrelated', cwd: '/Users/me/workspace/other' },
    ]),
  })
  ui.find('dsp-input').props.onChange({ target: { value: 'test-dsh' } })
  // Before the path was included, "test-dsh" matched nothing: the only searchable
  // strings were the title and the folder *basename* ("palette").
  assert.deepEqual(rowTitles(ui), ['Build the thing'])
})

test('a renamed workspace does not hide the folder it lives in', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([
      { id: 'a', title: 'Silo 产品立项', cwd: '/Users/me/workspace/project_silo' },
      { id: 'b', title: 'Other', cwd: '/Users/me/workspace/other' },
    ]),
    workspaces: {
      items: [
        { workspaceId: 'w1', title: 'Silo 正式开发', path: '/Users/me/workspace/project_silo', sessionIds: ['a'] },
      ],
    },
  })
  // The workspace title wins as the subtitle, which is exactly why the folder has
  // to stay searchable on its own.
  ui.find('dsp-input').props.onChange({ target: { value: 'project_silo' } })
  assert.deepEqual(rowTitles(ui), ['Silo 产品立项'])
})

//#endregion


//#region tags
//
// A tag editor belongs to the item it edits. The first version made it a mode of
// the search field, and that was wrong in a way the user felt immediately: the
// field that searches sessions started filtering tags, and the list had to be
// frozen to keep the target still. These tests pin the corrected model — the
// editor lives in the preview pane, the search field keeps searching, and the
// list stays live.

/** Config with four tags and one tagged session. */
function tagsConfig(extra = {}) {
  return {
    takeOver: true,
    tags: [
      { id: 'fire', label: '重要', emoji: '🔥', color: 'red' },
      { id: 'lab', label: '实验', emoji: '', color: 'blue' },
      { id: 'later', label: '以后', emoji: '', color: 'gray' },
      { id: 'fourth', label: '第四个', emoji: '', color: 'green' },
    ],
    assignments: [{ sessionId: 'a', tags: ['fire'] }],
    ...extra,
  }
}

/** Open the palette with tags and press ⌘⇧T. */
function tagUi(options = {}) {
  const made = paletteUi({
    sessions: sessionsOf([
      { id: 'a', title: 'Tagged one' },
      { id: 'b', title: 'Plain one' },
    ]),
    ctx: { configValue: { ...tagsConfig(), ...(options.config ?? {}) } },
    ...options.ui,
  })
  made.ui.find('dsp-card').props.onKeyDown(press('t', { shiftKey: true, metaKey: true }))
  return made
}

test('⌘⇧T opens a tag editor in the preview, and leaves the search field alone', () => {
  const { ui } = tagUi()

  const field = ui.find('dsp-input')
  assert.equal(field.props.role, 'combobox', 'the field is still the session search')
  assert.equal(field.props['aria-controls'], 'dsp-listbox')
  assert.equal(field.props.value, '', 'and it is not carrying a tag draft')

  const input = ui.find('dsp-taginput')
  assert.ok(input !== null, 'the editor opened in the pane')
  assert.equal(input.props.value, '')
  assert.equal(input.props.placeholder, 'tags.filterPlaceholder')
  assert.equal(input.props['aria-controls'], 'dsp-taglistbox')
  assert.equal(input.props['aria-activedescendant'], 'dsp-tagopt-0')

  assert.equal(ui.find('dsp-addtag').props['aria-expanded'], 'true')
  // Every vocabulary entry is offered, with the tagged one already ticked.
  assert.deepEqual(
    ui.all('dsp-tagrow').map((row) => row.props['aria-selected']),
    ['true', 'false', 'false', 'false'],
  )
})

test('one field, one job: the editor filters tags, the field filters sessions', () => {
  const { ui } = tagUi()

  // In the editor, typing narrows the TAG list and leaves the query (and the
  // session list) alone. This is what the previous version got wrong: the same
  // keystrokes used to mean two different things depending on a hidden mode.
  ui.find('dsp-taginput').props.onChange({ target: { value: '实验' } })
  assert.equal(ui.find('dsp-input').props.value, '', 'the session query is untouched')
  assert.deepEqual(rowTitles(ui), ['Tagged one', 'Plain one'], 'and the list is untouched')
  assert.deepEqual(
    ui.all('dsp-tagrow').map((row) => row.props.id),
    ['dsp-tagopt-0'],
    'while the tag list narrowed — an exact label offers no create row',
  )

  // In the search field, typing narrows SESSIONS — and that moves the highlight,
  // which closes an editor that belonged to the old row.
  ui.find('dsp-input').props.onChange({ target: { value: 'Plain' } })
  assert.deepEqual(rowTitles(ui), ['Plain one'], 'the list filters by session again')
  assert.equal(ui.find('dsp-tageditor'), null, 'the editor belonged to the old row')
})

test('Enter toggles a tag through the assignments field', async () => {
  const { ui, record } = tagUi()
  // Second option is "实验", untouched by session a.
  ui.find('dsp-taginput').props.onKeyDown(press('ArrowDown'))
  ui.find('dsp-taginput').props.onKeyDown(press('Enter'))
  await Promise.resolve()

  assert.deepEqual(plain(record.configWrites[0]), {
    field: 'assignments',
    value: [{ sessionId: 'a', tags: ['fire', 'lab'] }],
  })
  assert.equal(ui.find('dsp-tagline').children.flat(Infinity).filter((c) => c?.props?.className === 'dsp-chip').length, 2)
})

test('a fourth tag is refused with a reason instead of failing silently', async () => {
  const { ui, record } = tagUi({
    config: { assignments: [{ sessionId: 'a', tags: ['fire', 'lab', 'later'] }] },
  })
  const before = record.configWrites.length
  const input = () => ui.find('dsp-taginput')
  input().props.onKeyDown(press('ArrowDown'))
  input().props.onKeyDown(press('ArrowDown'))
  input().props.onKeyDown(press('ArrowDown')) // "第四个"
  input().props.onKeyDown(press('Enter'))
  await Promise.resolve()

  assert.equal(record.configWrites.length, before, 'the ceiling is not a write that gets rolled back')
  assert.equal(ui.palette.store.getSnapshot().notice.text, 'tags.full')
})

test('typing a name the vocabulary does not have creates it and applies it', async () => {
  const { ui, record } = tagUi()
  ui.find('dsp-taginput').props.onChange({ target: { value: '新想法' } })
  assert.equal(ui.find('dsp-tagrow').props.id, 'dsp-tagopt-0', 'the create row leads')
  ui.find('dsp-taginput').props.onKeyDown(press('Enter'))
  await Promise.resolve()

  const tagsWrite = record.configWrites.find((write) => write.field === 'tags')
  assert.ok(tagsWrite !== undefined, 'the vocabulary is written')
  const created = tagsWrite.value[tagsWrite.value.length - 1]
  assert.equal(created.label, '新想法')
  // The id is derived once and stays: the label may be edited later.
  assert.equal(created.id, '新想法')
  const assigned = record.configWrites.find((write) => write.field === 'assignments')
  assert.ok(assigned !== undefined, 'and applied to the highlighted session')
  assert.equal(assigned.value[0].tags.includes(created.id), true)
})

test('the list stays live, and moving the highlight closes the editor', () => {
  const { ui } = tagUi()
  assert.ok(ui.find('dsp-tageditor') !== null)

  // No freeze: the pointer moves the highlight, exactly like everywhere else.
  ui.all('dsp-row')[1].props.onMouseEnter()
  assert.deepEqual(rowTitles(ui), ['Tagged one', 'Plain one'], 'the list is not locked')
  // An editor belongs to the row it opened on, so it closes rather than silently
  // retargeting — which is the failure the frozen version was blamed for.
  assert.equal(ui.find('dsp-tageditor'), null)
  assert.deepEqual(
    ui
      .all('dsp-row')
      .filter((row) => row.props['aria-selected'] === 'true')
      .map((row) => String(row.props.id).replace(/^dsp-opt-/, '')),
    ['b'],
    'and the highlight is where the pointer put it',
  )
})

test('Escape closes the editor and keeps the query', () => {
  const { ui } = tagUi()
  // Build the query first, then open the editor on the row it selected — the way
  // the flow actually goes.
  ui.find('dsp-input').props.onChange({ target: { value: 'Plain' } })
  ui.find('dsp-card').props.onKeyDown(press('t', { shiftKey: true, metaKey: true }))
  assert.ok(ui.find('dsp-tageditor') !== null)

  ui.find('dsp-taginput').props.onKeyDown(press('Escape'))
  assert.equal(ui.find('dsp-tageditor'), null)
  assert.equal(ui.find('dsp-input').props.value, 'Plain', 'the search is where it was')
})

test('the preview always shows the session tags, and its + opens the editor', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'Tagged' }]),
    ctx: { configValue: tagsConfig() },
  })
  const line = () => ui.find('dsp-tagline')
  assert.ok(line() !== null, 'no editor needed to see the tags')
  const chips = line().children.flat(Infinity).filter((c) => c?.props?.className === 'dsp-chip')
  assert.equal(chips.length, 1, 'the session tag is visible while reading')
  assert.equal(chips[0].props['aria-pressed'], 'false', 'and it is the filter control')

  ui.find('dsp-addtag').props.onClick()
  assert.ok(ui.find('dsp-tageditor') !== null, 'the button opens the editor too')
})

test('a tag chip filters the list, and clicking it again clears the filter', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'Tagged' }, { id: 'b', title: 'Plain' }]),
    ctx: { configValue: tagsConfig() },
  })
  assert.deepEqual(rowTitles(ui), ['Tagged', 'Plain'])
  const chip = ui.all('dsp-chip')[0]
  chip.props.onClick()
  assert.deepEqual(rowTitles(ui), ['Tagged'], 'only the tagged session survives')
  assert.equal(ui.all('dsp-chip')[0].props['aria-pressed'], 'true')

  ui.all('dsp-chip')[0].props.onClick()
  assert.deepEqual(rowTitles(ui), ['Tagged', 'Plain'], 'and the filter is a toggle')
})

test('the filter bar lists only tags in use, and offers a way out', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'Tagged' }, { id: 'b', title: 'Plain' }]),
    ctx: { configValue: tagsConfig() },
  })
  // Only the bar: the preview renders the same chip component for the highlighted
  // session's own tags.
  const bar = () => (ui.find('dsp-filters')?.children ?? []).flat(Infinity).filter(Boolean)
  const chipText = () =>
    bar()
      .map((chip) => {
        const label = chip.children?.find?.((child) => child?.props?.className === 'dsp-chiplabel')
        if (label === undefined) return null
        const count = chip.children.find((child) => child?.props?.className === 'dsp-chipcount')
        return `${label.children[0]}|${count?.children?.[0] ?? ''}`
      })
      .filter((value) => value !== null)

  // The vocabulary has four tags; only "重要" is on a session, so only it is a
  // filter — an unused tag would be a control that can only empty the list.
  assert.deepEqual(chipText(), ['重要|tags.count({"n":1})'])

  bar()[0].props.onClick()
  assert.deepEqual(chipText(), ['重要|tags.count({"n":1})'], 'the count survives the filter')
  const clear = bar().find((chip) => chip.props['aria-pressed'] === undefined)
  assert.ok(clear !== undefined, 'and a clear control appears while a filter is active')

  clear.props.onClick()
  assert.deepEqual(rowTitles(ui), ['Tagged', 'Plain'], 'clearing restores the list')
})

test('a Host that cannot store tags says so instead of pretending', async () => {
  // The pre-tag schema: the fields are absent, not empty.
  const made = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'A' }]),
    ctx: { configValue: { takeOver: true } },
  })
  made.ui.find('dsp-card').props.onKeyDown(press('t', { shiftKey: true, metaKey: true }))
  const notes = made.ui
    .nodes()
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
  assert.ok(notes.includes('tags.notReadyHint'), 'the editor explains the restart')

  made.ui.find('dsp-taginput').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  assert.deepEqual(made.record.configWrites, [], 'nothing is written into a schema that would drop it')
  assert.equal(made.ui.palette.store.getSnapshot().notice.text, 'tags.notReady')
})

test('a half-migrated schema cannot be written to either', async () => {
  // A vocabulary without an assignment field: the editor has something to offer,
  // so the guard that matters is the one on the write path.
  const made = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'A' }]),
    ctx: {
      configValue: {
        takeOver: true,
        tags: [{ id: 'fire', label: '重要', emoji: '🔥', color: 'red' }],
      },
    },
  })
  made.ui.find('dsp-card').props.onKeyDown(press('t', { shiftKey: true, metaKey: true }))
  assert.equal(made.ui.all('dsp-tagrow').length, 1, 'the vocabulary is offered')
  made.ui.find('dsp-taginput').props.onKeyDown(press('Enter'))
  await Promise.resolve()
  assert.deepEqual(made.record.configWrites, [])
  assert.equal(made.ui.palette.store.getSnapshot().notice.text, 'tags.notReady')
})

test('the sidebar menu row opens the palette in tag mode for its own row', () => {
  const loaded = loadPlugin()
  const made = makeCtx({ configValue: tagsConfig() })
  loaded.plugin.apply(made.ctx)
  const dismissed = []
  const ui = mount(loaded, made.record, {
    entryId: `${ROW_ID}.tags`,
    onMenuDismiss: (value) => dismissed.push(value),
    props: { sessionId: 'a', displayTitle: 'A' },
  })

  // Without the primitives table the row falls back to its own button, and it still
  // carries an icon: an icon-less row beside Pin/Rename/Fork/Archive is the thing
  // this fallback must not reproduce.
  const row = ui.find('dsp-menuitem')
  assert.equal(row.props.role, 'menuitem')
  assert.equal(row.children[0].type, 'svg', 'the tag glyph')
  assert.deepEqual(row.children[1].children, ['tags.manage'])
  row.props.onClick()

  assert.deepEqual(dismissed, [false], 'the menu closes first')
  const state = ui.palette.store.getSnapshot()
  assert.equal(state.open, true)
  assert.equal(state.tagRequest.id, 'a')
})

test('a tag request is consumed once, so ⌘K later opens a plain palette', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]),
    ctx: { configValue: tagsConfig() },
  })
  ui.palette.store.update((state) => ({ ...state, tagRequest: { id: 'b', seq: 1 } }))
  ui.render()
  assert.equal(ui.palette.store.getSnapshot().tagRequest, null, 'consumed')
  assert.ok(ui.find('dsp-tageditor') !== null, 'and the editor opened')
  const selected = ui
    .all('dsp-row')
    .filter((row) => row.props['aria-selected'] === 'true')
    .map((row) => String(row.props.id).replace(/^dsp-opt-/, ''))
  assert.deepEqual(selected, ['b'], 'aimed at the requested session')
})

test('tags sit after the title, not at the trailing edge', () => {
  const { ui } = paletteUi({
    sessions: sessionsOf([{ id: 'a', title: 'Tagged' }]),
    ctx: { configValue: tagsConfig() },
  })
  const title = ui.find('dsp-rowtitle')
  assert.equal(title.children[0].props.className, 'dsp-rowtitletext', 'the text comes first')
  assert.equal(title.children[1].props.className, 'dsp-rowtags', 'then the tags')
  assert.equal(title.children[1].props['aria-label'], '重要')
})

//#endregion

//#region what a mode owns
//
// Rename still owns the search field — a title is one line — so it keeps the mode
// bar that says which session it is acting on.

test('the rename mode bar names the session, and does not outlive the mode', () => {
  const { ui } = paletteUi({ sessions: sessionsOf([{ id: 'a', title: 'Old name' }]) })
  assert.equal(ui.find('dsp-modebar'), null, 'nothing to say while searching')

  ui.find('dsp-card').props.onKeyDown(press('r', { shiftKey: true, metaKey: true }))
  const text = ui
    .find('dsp-modebar')
    .children.flat(Infinity)
    .map((child) => (typeof child === 'string' ? child : child?.children?.[0]))
    .filter((child) => typeof child === 'string')
    .join(' ')
  assert.match(text, /rename\.bar/)
  assert.match(text, /Old name/)

  ui.find('dsp-card').props.onKeyDown(press('Escape'))
  assert.equal(ui.find('dsp-modebar'), null)
})

//#endregion
