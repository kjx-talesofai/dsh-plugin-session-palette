<p align="center">
  <img src="assets/icon.svg" alt="dsh-plugin-session-palette" height="112"/>
</p>

# dsh-plugin-session-palette

Press <kbd>⌘K</kbd> and get a **Spotlight-style session palette** instead of a search box in the corner — recent first, running and waiting sessions on top, a preview of each session's **last turn** before you commit to opening it, two ways to **rename a session in place** — <kbd>⌘⇧R</kbd> on the highlighted row, or a **double click on the title** at the top of an open conversation — and **tags**: up to three per session, clickable to filter.

<p align="center">
  <a href="https://github.com/kjx-talesofai/dsh-plugin-session-palette/releases"><img src="https://img.shields.io/github/v/release/kjx-talesofai/dsh-plugin-session-palette?label=release&style=flat-square&color=blue" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kjx-talesofai/dsh-plugin-session-palette?label=license&style=flat-square&color=green" alt="license"></a>
  <a href="https://github.com/kjx-talesofai/dsh-plugin-session-palette/actions/workflows/ci.yml"><img src="https://github.com/kjx-talesofai/dsh-plugin-session-palette/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI"></a>
  <img src="https://img.shields.io/badge/DSH-%E2%89%A5%200.2.0--rc.1-blueviolet?style=flat-square" alt="DSH >= 0.2.0-rc.1">
</p>

> dsh-plugin-session-palette — ⌘K 弹出会话面板：最近优先，正在运行与等待你的置顶，预览最后一个 turn，⌘⇧R 或双击标题就地改名，还能给会话打标签（最多 3 个，点标签就筛选）

<details>
<summary><b>中文说明（点开）</b> —— ⌘K 从「聚焦侧边栏搜索框」变成「蹦出一个会话面板」</summary>

**它是什么**：DSH Web 客户端的会话切换器。按 <kbd>⌘K</kbd>，屏幕上方弹出一个面板：左边是会话列表（按「需要你 / 活跃 / 今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早」分组），右边是高亮那条的预览——包含它最后一个 turn 的**你的提问**和**模型回复**。方向键选，回车进。

**为什么做**：DSH 原本的 <kbd>⌘K</kbd> 是「展开侧边栏 → 展开搜索框 → 把焦点丢进左下角那个输入框」。要切换会话，视线得从正文移到屏幕角落，而且只能看到一个平铺列表。VS Code 的 <kbd>⌘P</kbd>、Sublime 的 <kbd>⌘P</kbd>、macOS 的 <kbd>⌘空格</kbd> 都是把它做成**视线所在处弹出的浮层**——因为切换会话是高频动作，值得一次专门的界面。

**四个视图**（<kbd>Tab</kbd> 向前循环、<kbd>⇧Tab</kbd> 向后）：

| 视图 | 回答的问题 | 内容 |
|---|---|---|
| **最近**（默认） | 现在在发生什么 | 全部会话，按活跃度 + 时间分组 |
| **工作区** | 我不记得标题，只记得那个目录 | 按目录分组，组头就是工作区名，最近碰过的排前面 |
| **置顶** | 我留下过什么 | 你置顶的，**按置顶顺序**（最近置顶在前） |
| **归档** | 我收起来过什么 | 已归档的，行变暗 |

**抽屉，不是分组**——这是这个插件最核心的设计判断。一个 25 天前置顶的会话和今天没有任何关系，把它钉在「今天」上面占着首屏就是噪音。「**怕忘了**」的意思是**必须找得到**，不是**必须一直看见**。所以置顶和归档各是一个**带计数的可切换视图**：计数负责提醒你里面还有东西，抽屉负责在你需要时把它给你；而它们**完全不影响「最近」的排序**。

**和一个搜索的区别**：这不是「更好的搜索」，是「更快地切回去」。所以它打开时**不输入任何东西**就已经列好了会话——<kbd>⌘K</kbd> 之后直接按方向键就能跳。

**怎么装**（在 DSH「添加插件」里填，**不需要 npm 账号、也无需发布**）：

| 填入 | 形式 |
|---|---|
| GitHub | `github:kjx-talesofai/dsh-plugin-session-palette#v0.7.0`（当前可用） |
| 本地目录 | 绝对路径，例如 `/path/to/dsh-plugin-session-palette` |

装完**重启桌面端**（host 半边只在启动时加载）。

**怎么用**：

| 按键 | 动作 |
|---|---|
| <kbd>⌘K</kbd> | 打开 / 收起面板 |
| <kbd>↑</kbd> <kbd>↓</kbd> | 移动高亮（循环），鼠标划过也会移动 |
| <kbd>Home</kbd> <kbd>End</kbd> | 首 / 末（输入框光标已在两端时） |
| <kbd>⏎</kbd> | 打开高亮的会话 |
| <kbd>⌘⇧R</kbd> | 给高亮的会话**改名**（复用上面那个输入框，⏎ 保存 / esc 取消） |
| **双击标题** | 在已经打开的会话里，双击顶部那个名字 → 就地弹出输入框改名 |
| <kbd>⌘⇧T</kbd> | 给高亮的会话打标签（右栏变成标签选择器：打字筛/新建、<kbd>⏎</kbd> 加或去掉、<kbd>esc</kbd> 完成） |
| <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> | 循环三个视图 |
| <kbd>⌘⇧P</kbd> | 置顶 / 取消置顶 |
| <kbd>⌘⇧⌫</kbd> | 归档 / 恢复 |
| <kbd>⌘↑</kbd> / <kbd>⌘↓</kbd> | 跳到第一条 / 最后一条（光标在哪儿都生效） |
| <kbd>PgUp</kbd> / <kbd>PgDn</kbd> | 翻一屏（到底就停，不回头） |
| <kbd>esc</kbd> | 关闭 |

**注意事项**：

- **它会接管 <kbd>⌘K</kbd>**，这是它存在的意义。侧边栏那个搜索按钮**照旧能用**（鼠标点），只是键盘快捷键让给了面板。
- **改名不是新开一个输入框**：<kbd>⌘⇧R</kbd> 之后，你最上面那个搜索框**原地变成标题编辑框**（列表还按你原来的查询筛着，高亮还停在要改的那一行）。打完 <kbd>⏎</kbd> 保存，<kbd>esc</kbd> 放弃；失败时原因显示在输入框下面一行，草稿不会被吃掉。成功后的提示里带**撤销**。
- **标签存在插件的 Config 里**（volatile 字段），写在 profile 的 `cordis.patch.yml`，重启后还在。**每个会话最多 3 个**；标签是「文字 + 可选 emoji + 颜色」，颜色只用主题 token，所以亮/暗色都跟着走。
- **点标签就是筛选**：面板里那排标签（只列真正用上的）点一下筛，再点一下取消，多个标签是「任一命中」。预览窗格里会话自己的标签也是同一个控件。
- **行里的标签跟在标题后面**（`标题 🔥🧪`），因为扫列表时眼睛停在标题上，不是停在右边缘。
- **长列表不会迷路**：分组标题是**吸顶**的（滚到哪都写着"今天/昨天/更早"），页脚左边写着**你在第几条**（`37 / 340`），超过一屏的跳转有 <kbd>⌘↑</kbd>/<kbd>⌘↓</kbd> 和 <kbd>PgUp</kbd>/<kbd>PgDn</kbd>。
- **超过 7 天的行显示日期**（`9月12日`），不是 `23 天前`——"上个月那个"是日期问题。
- **浮窗够大**：1180px / 88vh，左 60 右 40。它存在的意义就是让你在里面认真翻，缩手缩脚没道理。
- **标签编辑器长在会话详情里，不长在搜索框里**。搜索框永远只搜会话；标签的输入框在右栏，是第二个输入框，所以"我在打标签还是我在搜会话"从来不用猜。第一版把搜索框兼职成标签筛选，被否掉了。
- **列表永远是活的**：鼠标划过、点行都照常。标签编辑器属于它打开时的那一行——高亮一换，它就关掉，不会悄悄改到别的会话上。
- **标签需要一次 DSH 重启才生效**：存储字段是本版新加的 host 字段，而 host 半边只在启动时读。没重启之前，选择器会直接说「标签需要重启一次 DSH」，不会假装保存成功。
- **标题有字节上限**（DSH 默认 80 字节，中文约 26 个字）。超了 host 会截断，面板的提示报的是**实际存下来的标题**，不是你打的草稿。
- **双击标题**是在宿主自己的标题元素上挂的监听（匹配 `crumbCurrent` 这个类名后缀），所以它是这一版里**唯一依赖宿主 DOM 的地方**：DSH 哪天把这个类名改了，双击会静默失效（⌘K → ⌘⇧R 那条路不受影响）。侧边栏那排会话的**双击归宿主管**（它弹自己的改名框），这里刻意不碰。
- **它一个字都不改你的按键偏好**。接管走的是「固定键位」这条官方通道，只在内存里生效；所以**想关掉就干净地关掉**，没有需要还原的东西。
- **它不做全文搜索**（还没做）。现在匹配**会话标题**、**工作区名**和**工作区目录路径**（工作区被改过名之后，目录名仍然搜得到），不匹配消息正文。所以找一个"聊过某个话题"的会话，暂时还得用侧边栏那个搜索。
- **预览在旧会话上要等一下**：DSH 的 projection 缓存只覆盖约三分之二的会话，其余的是「很久没碰过的那些」。面板在高亮停留约 0.2 秒后才会去读它们（一次一行，不并发），所以快速划过时不会卡。
- 预览里的**文案是「你 X 前发言」而不是「X 前」**——因为 DSH 的 `updatedAt` 记的是**你最后一次输入的时间**，模型回复**不会**推进它。写"2 小时前"会骗人。

**卸载**：DSH「插件」列表里卸载 `dsh-plugin-session-palette` → 重启；或「Restore All」恢复按键默认值。**无需清理任何偏好**——它没写过。

**老实说（实测范围）**：只在 **macOS（Apple Silicon）+ DSH Desktop 0.2.0-rc.2** 上端到端跑过。Windows / Linux 未测；DSH 升级后上游契约可能变化，见下方 Compatibility。

</details>

## Why

DSH's <kbd>⌘K</kbd> expands the sidebar, expands the search field, un-collapses the rail if needed, and *then* focuses the input — with a 300 ms delay when the rail has to slide open first. Switching sessions is a high-frequency action, and the cost lands in the worst place: your eyes have to leave the conversation and find a field in the corner.

Every tool that solves this well solves it the same way — VS Code, Sublime, Spotlight — with an overlay at the point of attention. This is that overlay.

The second problem is ordering. The host sorts sessions by `updatedAt`, which is `max(createdAt, lastPromptAt)`: **the last time the user wrote**, not the last time anything happened. An agent reply does not move it. So a session whose agent just finished, or one that is blocked waiting for your approval, can sit below a dozen conversations you merely touched more recently. The palette ranks *live state* above the clock — waiting on you, then running, then finished-but-unread — and only then falls back to recency buckets.

## The views

`Tab` cycles. Each view answers a different question about the same set, which is why they are views rather than sections of one list.

| View | Question | Ordering |
|---|---|---|
| **Recents** | What is happening now? | Needs-you → Active → Today → Yesterday → Previous 7 days → Previous 30 days → Older |
| **Workspaces** | I remember the folder, not the title | One group per workspace folder, freshest group first, recency inside |
| **Pinned** | What did I keep? | Pin order, most recently pinned first |
| **Archived** | What did I put away? | Most recently active first; rows are dimmed |

Two consequences worth stating plainly:

- **A pin is not a promotion.** Pinned and archived sessions are removed from the Recents ordering entirely — they do not float up, and they do not sort higher in a query. The drawer's count is the reminder; the drawer itself is the retrieval.
- **A row appears in exactly one Recents group**, the most urgent one it qualifies for. A pinned session that starts running shows up under Active, not under Pinned.

## Install

Use DSH's own **Add plugin** dialog. No npm account, no publishing.

| Field | Value |
|---|---|
| GitHub | `github:kjx-talesofai/dsh-plugin-session-palette#v0.7.0` |
| Local directory | an absolute path, e.g. `/path/to/dsh-plugin-session-palette` |

Restart the desktop app afterwards: the Host half is only loaded at startup. The browser half reloads with the page.

This plugin is **not published to npm**, and `npm install` is not the install path — a plain `npm install` of the tarball would also drag in the whole Harness as a peer dependency.

## Usage

1. Press <kbd>⌘K</kbd>. The palette opens with your sessions already listed.
2. Type to narrow by **title, workspace name, or the directory the workspace lives in** (fuzzy-matched, ordered-subsequence — the same ranker the host's own `/` menu uses). The directory matters because a renamed workspace no longer shows its folder, and the folder is what you remember.
3. <kbd>↑</kbd>/<kbd>↓</kbd> or hover to move the highlight; the right-hand pane previews that session's last turn.
4. <kbd>⏎</kbd> opens it. <kbd>Tab</kbd> switches to the Pinned or Archived drawer.
5. <kbd>⌘⇧R</kbd> renames the highlighted session right there — the search field becomes the title field, <kbd>⏎</kbd> saves, <kbd>esc</kbd> cancels.
6. <kbd>⌘⇧P</kbd> pins, <kbd>⌘⇧⌫</kbd> archives, and both toggle — so the same chord restores.
7. In an open conversation, **double-click the title** in the header to rename it there — the same editor, floated over the title's own box.
8. <kbd>⌘⇧T</kbd> opens the tag picker for the highlighted session: type to narrow, type a name nothing matches to **create** it, <kbd>⏎</kbd> toggles, <kbd>esc</kbd> done. Tags show as glyphs on the row and as chips in the preview; **clicking a chip filters** the list (several = any of them).

### Tags

A tag is `id + label + optional emoji + colour`. Five colours, each a theme token, so light and dark follow without a second palette. A session carries **at most three**; the ceiling is refused out loud ("Three tags is the limit") rather than truncated, because a fourth tag the user cannot see is worse than a no.

- **Where they live**: the plugin's Config, next to `takeOver`. Both tag fields are `.volatile()`, which is load-bearing twice — only volatile fields are accepted on write, and the Loader compares volatile fields out of its config diff, so saving a tag updates the running plugin instead of remounting it. Without that, the act of tagging would close the palette it was done from.
- **Identity is the id**, derived from the label when the tag is created and stable afterwards, so renaming a tag later cannot orphan the sessions that point at it.
- **The filter means "any of"**: tags are how you group work that spans workspaces and dates, so narrowing on two tags should show both groups, not their intersection.
- **One picker, attached to the item.** The sidebar's session menu row (with a tag icon, styled by the shipped `MenuItemButton`) opens the palette with that session highlighted and the picker already up, instead of growing a second tag UI to keep in step.

The editor is a **popover-like block inside the preview pane**, under the session's own tag chips: its own input, its own list, its own Escape. The search field keeps searching sessions the whole time, and the list is never frozen — moving the highlight simply closes the editor, because an editor belongs to the row it was opened on. That is the corrected model; the first version made the search field filter tags while the list was locked, and it was unusable for exactly the reason you would expect: two meanings on one field, and a target that could not be moved.

**This needs one DSH restart.** The tag store is new host-side Config, and the Host reads `index.js` at startup — so until DSH restarts, the picker says "Tags need one DSH restart" and refuses to write. It never pretends to save.

### Finding your way around a long list

A palette that asks you to browse needs landmarks. Three, in order of how much they do:

- **Sticky group headings.** After two screens the only thing left was a wall of identical rows; the heading now stays at the top of the scrollport, so "this is yesterday" is always on screen.
- **A position, not just a total.** The footer reads `37 / 340` — the whole point is answering "am I lost?", which `340 sessions` cannot.
- **Jumps that always work.** <kbd>⌘↑</kbd>/<kbd>⌘↓</kbd> go to the ends from anywhere (Home/End already did, but only once the caret reached an edge), and <kbd>PgUp</kbd>/<kbd>PgDn</kbd> move a screenful — clamped, because a page that jumps back to the top reads as a bug.

Two smaller ones: rows older than a week show **the date you worked on them** rather than `23d` (a duration is not what you remember about last month), and the card is **1180px × 88vh** — this surface exists for browsing, so it should not be shy about space.

### Renaming

The highlight is already the thing you are about to act on, so a rename edits *that row* and nothing else. <kbd>⌘⇧R</kbd> turns the search field into a title field: same place, same line height, focus never moves, the query stays applied and the highlight stays put. <kbd>⏎</kbd> saves, <kbd>esc</kbd> restores the query, and a rejected write leaves the draft in place with the host's reason on its own line underneath.

Three decisions are worth naming:

- **⌘⇧R, not ⌘R** — `page.refresh` owns <kbd>⌘R</kbd>, and <kbd>⌘⌥G</kbd> is the host's own `session.rename`. Both are chords the Electron main process intercepts before the page ever sees them, so a handler on either would never run and the host would act behind the palette instead. Shift+R is unclaimed by every shipped command, which is a property of the current catalog rather than a promise.
- **The search field, not a second input** — an input inside a `role="option"` row is invisible to the accessibility tree, and a second text box would have to fight the row's focus handling. One field, two jobs, and its ARIA role changes with the job.
- **`sessions.using`, not a direct call** — the host refuses to rename a session that is not live in its store, so the write goes through a retained reference (the same path the shipped sidebar uses). The retain is attributed to `sessionPalette` in `retainInfo`, and it lasts for exactly one call.

The bytes you type are not the bytes stored: the host normalizes whitespace and shortens a title past `maxTitleBytes` (80 in the shipped bundle). The toast therefore reports the title the host **accepted**, and Undo is only offered when there was a title to go back to.

### How it works

The Chrome-free parts: the palette is one component registered into the frame-wide `shell.overlay` seat, rendering `role="dialog" aria-modal="true"` — which is what makes it a real modal for the host's Escape arbitration and for background-shortcut gating. The toast is a **second** entry in the same seat so it outlives the palette.

Taking <kbd>⌘K</kbd> is the interesting part, and it writes no preference:

| Step | Mechanism |
|---|---|
| 1 | `ctx.shortcuts.register` refuses any default that overlaps `session.search`, and there is no unregister API — so the chord cannot be claimed by registering a command |
| 2 | `ctx.shortcuts.registerFixed` performs **no** conflict check, so a fixed binding on <kbd>⌘K</kbd> is accepted |
| 3 | That fixed binding makes `session.search` *conflicted*, which removes `meta+KeyK` from the Electron main process's natively intercepted set |
| 4 | With the chord no longer intercepted, the DOM `keydown` reaches the page, where fixed observers run **before** configurable dispatch — and consume it |

Steps 2–4 were verified end to end against a running app before the palette was written. A fixed binding is deliberately **not user-rebindable**, which is why the plugin also registers a normal, unbound command (`session.palette`) that you can attach your own chord to in Settings → Shortcuts.

The preview comes from the host's `turnOutline` projection, which already carries every turn's prompt (≤50 code points) and response (≤120) into the session list — so for most sessions it costs **no request at all**. Measured coverage was about two thirds; the rest are the sessions you have not touched in a long time, and those are read lazily, one at a time, after the highlight settles.

## What it does not reach

- **No tag editor yet.** Tags are created from the picker (label only, colour assigned in a ring); there is no UI yet for emoji, colour or renaming a tag — that is the next release. The Config page in Plugin management shows the raw data in the meantime.
- **No content search yet.** Matching covers the session title, the workspace name and the workspace path. The message-body search the shipped sidebar performs is not wired in.
- **No query language yet.** `@workspace`, `is:archived`, `after:7d` and filter chips are designed but not implemented.
- **No settings UI yet.** The one switch (`takeOver`) lives in your profile's `cordis.patch.yml`:
  ```yaml
  - id: session-palette
    name: 'dsh-plugin-session-palette'
    config:
      takeOver: false      # hand ⌘K back to the shipped sidebar search
  ```

- **The fixed chord is not user-rebindable.** That is a property of the mechanism, not an oversight; the unbound companion command is the escape hatch.
- **Archiving a session with running work** is refused by the Host, and the palette reports it as a plain failure rather than offering the shipped stop-and-archive flow.
- **A rename briefly opens the session.** Renaming requires a retained reference, and retaining starts the session's history open. Rename is an explicit one-shot action, so this is the same cost the shipped sidebar pays for its own row rename — but it is not free on a session you have never opened.
- **The rename chord is the fixed part, not the title.** <kbd>⌘⇧R</kbd> is a local handler, so it only works while the palette has focus, and it is not rebindable.
- **The header double click depends on one class name suffix.** `crumbCurrent` is a CSS-module class, so the hash changes between builds and the suffix does not; if DSH ever renames the suffix the gesture stops working silently. Nothing else breaks, and <kbd>⌘K</kbd> → <kbd>⌘⇧R</kbd> still renames.
- **No session deletion**, ever — archived sessions are recoverable, which is what the Archived drawer is for.

## Compatibility

Verified against **DSH 0.2.0-rc.2** on macOS (Apple Silicon), in a real profile. The plugin depends on the following upstream contracts, each of which was checked against the shipped bundles rather than assumed:

| Contract | Where it comes from |
|---|---|
| `shell.overlay` as a root-scoped `list` slot with standard session hooks | `dsh-client-ui-layout`, `dsh-client-ui-renderer`, `dsh-client-ui-session` |
| `registerFixed` / `observeFixedInput`, and fixed bindings being excluded from native interception | `dsh-client-shortcuts` |
| The dotted command-id pattern (a bad id silently disables **every** keyboard command) | `dsh-client-shortcuts` |
| `ctx.sessions.list`, `refreshProjections`, `ctx.uiWorkspace`, `ctx.workspaces` | `dsh-api-session-controller`, `dsh-client-ui-workspace`, `dsh-api-workspace-controller` |
| `sessions.using` → `reference.binding.session.rename`, and the host's "not live in this store" refusal | `dsh-api-session-controller`, `dsh-session-title` |
| Native interception keyed on exact chord + modifiers, unmatched chords reaching the main frame | `lib/main.js` (`before-input-event`) |
| `turnOutline` (per-turn prompt/response previews) | `dsh-session-turn-outline` |
| `retainedBy.mainView` as "the current session" (the header's title span is found by its `crumbCurrent` class suffix) | `dsh-client-ui-workspace`, `dsh-client-ui-conversation` |

Upstream may change any of these. A failure in the shortcut contract is the one to watch: it is silent rather than loud.

## Development

```sh
npm test          # 107 tests, no install step required
```

There is deliberately **no build step**: `client.js` is the shipped browser bundle, and the Host half is a single `index.js`.

The suite evaluates the browser half as a script in `node:vm` (so the artifact really is a script-executable module-loader bundle), drives the **real component** through a small hooks runtime, and reads the Host half as **text** — never importing it, because that would need `@deepseek-ai/schemastery` and make a bare checkout fail.

| Path | Ships to users | Purpose |
|---|---|---|
| `client.js` | ✓ | The browser half — component, styles, dictionaries, shortcut claim |
| `index.js` | ✓ | The Host half — the `Config` schema and a no-op `apply` |
| `cordis.patch.yml` | ✓ | The bundle row that mounts the package |
| `locale/*.json` | ✓ | Plugin-manager display metadata (en / zh) |
| `assets/icon.svg` | ✓ | Plugin icon |
| `tests/plugin.test.mjs` | ✗ | Contract + rendered-behaviour suite |
| `docs/plan.md` | ✗ | The design record: what was verified, and what was got wrong |
| `probe/` | ✗ | A separate diagnostic bundle that empirically proved the ⌘K mechanism |

`probe/` is kept as a **regression harness** for the shortcut mechanism: if a future DSH changes the fixed-binding conflict semantics or Electron's interception, re-running it answers that in one press instead of a re-derivation. It is a separate package, sets nothing by default, and is excluded from the tarball.

## Uninstall

Remove `dsh-plugin-session-palette` from DSH's plugin list and restart. **There is nothing to clean up** — the plugin writes no keybinding preference, no browser storage, and no profile state beyond its own optional `config` block.

## License

[MIT](LICENSE) © 2026 Jiaxin Kou

---

<p align="center">
  <sub>Built by <a href="https://hypersampling.com">hypersampling</a> · <a href="https://github.com/kjx-talesofai">GitHub</a></sub>
</p>
