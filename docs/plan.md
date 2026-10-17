# Session Palette — 调研与方案

> 目标：把 `⌘K` 从「聚焦侧边栏搜索框」改成「蹦出一个 Overlay 会话面板」，
> 支持按工作区 / 上次修改时间 / 归档状态等维度筛选，并在回车前预览高亮会话的最后一个 turn。

状态：**调研完成，方案待实施**。所有结论带 `文件:行` 证据；不确定的部分单独标注为「需实测」。
证据来自对 `app.asar` 内 `@deepseek-ai/*` 客户端的静态阅读 + live `cordis_inspect_query`。

---

## 0. 结论速览

| 问题 | 答案 |
| --- | --- |
| 能挂在哪？ | **`shell.overlay`** —— root 作用域 `list` 槽，`replaceRisk: none`，官方指定的「浮在整个 app 之上的自有界面」席位 |
| 能拿到会话数据吗？ | 能。槽位标准 props 直接给 `useSessions` / `useWorkspaces` / `useSessionStatus` / `useSessionRetainInfo` / `usePanelInfo` |
| 「归档」存在吗？ | **存在，Host 持久化**。`workspaces.list` 带 `archivedSessionIds` / `pinnedSessionIds`；归档会话不能打开、不能跑 |
| 有日期维度吗？ | 有，但只有一个时间戳 `updatedAt`，而且它 = **max(创建时间, 最后一次「用户」输入)** —— agent 回复**不会**推进它 |
| 能预览最后一个 turn 吗？ | 能，**零 I/O**：`turnOutline` projection 随持久化的 projection cache 进入每一行列表数据，已含每个 turn 的 `prompt`(≤50字) + `response`(≤120字) |
| 能拿到 `⌘K` 吗？ | **能，而且是官方 API、零偏好写入** —— `registerFixed()` + `observeFixedInput()`。见 §2 |
| 需要 import 宿主的客户端包吗？ | 技术可行（`ui-primitives` 在 seed 表里），但官方明令**不要**：要抄行为、抄 CSS，只用 `--dsw-alias-*` token |

**一句话方案**：纯前端插件，往 `shell.overlay` 注册一个 `role="dialog" aria-modal="true"` 的居中面板；
数据全部来自槽位内建 hooks，预览全部来自已在内存的 `turnOutline`；`⌘K` 用 `registerFixed` 拿到（默认开启，可在插件设置里关掉）。

---

## 1. 现状（已核实）

### 1.1 `⌘K` 绑在哪、实际是什么

`dsh-client-ui-workspace/lib/client.js:146-149`，经由同文件 `:108-139` 的本地 helper 展开：

```js
register("session.search", () => t("search.sessions.aria"), ["search sessions"],
         "KeyK", ["primary"], ["primary", "alt"],
         () => ({ status: "handled", run: controls.search }));
```

**注意有效键位分平台**（helper `:113-133`）：

| runtime | macOS | Windows | Linux |
| --- | --- | --- | --- |
| desktop（Electron） | **⌘K** | Ctrl+K | Ctrl+K |
| web（浏览器标签页） | ⌘⌥K | Ctrl+Alt+K | 未绑定 |

runtime 由 `document.documentElement.dataset.platform` 决定（`dsh-client-shortcuts/lib/client.js:721-724`），
该属性只由 Electron preload 设置（`lib/preload-app.cjs:52`）。
**你的 ⌘K 生效 => 你用的是 Electron 桌面窗口**，不是浏览器标签页。这点影响 §2 的方案选择。

`controls.search`（`:39-44`）只是个自增计数器。真正的效果在 `:2976-2984`：

```js
if (shortcutState.searchRequest === 0) return;
closeAddWorkspace();
setSearchExpanded(true);
if (!wide) { setSearchOnExpand(true); expandSidebar(); }   // 侧边栏是轨道时先展开
else searchInput.current?.focus({ preventScroll: true });
```

即：展开侧边栏 → 展开搜索框 → 把焦点丢进左下角那个 `<input>`。
若侧边栏当时是收起的轨道，焦点还会**延迟 300ms**（`EXPAND_SLIDE_MS`，`:2114`）等滑动动画结束。
**不会清空上一次的查询**。

同包另外 5 个命令（`regions:["page","editable"]`、`modals:[]`）：

| id | code | desktop | web |
| --- | --- | --- | --- |
| `session.new` | KeyN | primary | primary+alt |
| `workspace.add` | KeyO | primary | primary+alt |
| `session.rename` | KeyG | primary+alt | primary+alt |
| `session.fork` | KeyF | primary+alt | primary+shift |
| `session.archive` | KeyA | primary+shift | primary+alt |

### 1.2 现在的搜索体验

`deriveSearchResults()`（`:562-614`）是全部逻辑，两段式：

**A. 本地元数据（同步）** `:576-580`

```js
if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary);
```

- 大小写不敏感的**字面子串**，无模糊、无分词、无排序。
- 只匹配 **会话标题**（未命名会话的标题是空串，`:391-393`）和 **工作区名**（工作区 title，退化为 cwd 的 basename）。
  **不含完整路径，不含消息内容。**
- 结果按 `updatedAt` 倒序（`:279-291`）。

**B. Host 内容搜索（250ms 防抖 + AbortController）** `:3011-3051` → `ctx.sessions.search(query, signal)`
后端是 SQLite 全文（`dsh-session-query-sqlite:832` `ORDER BY match_count DESC, document_length ASC, time DESC …`），
snippet ≤240 code points，**结果上限 20**（`sessions.searchResultLimit`）。

**今天缺的东西**（这些就是"麻烦"的具体形态）：

- **结果列表完全没有键盘导航**。整个 ui-workspace 包里只有：搜索框上的 `Escape`、两个重命名对话框里的 `Enter`。
  没有 Arrow/Home/End，没有 `aria-activedescendant`，没有 roving tabindex。行是 `div role="treeitem"` + `onClick`，不可聚焦。
- **鼠标 hover 不改变选中状态** —— hover 只做两件事：CSS 显示行操作按钮、800ms 后弹 HoverCard。
- **没有匹配高亮**。标题和 snippet 都是纯文本节点（`:1508-1548`）。
- **没有空查询状态** —— 查询为空时结果区根本不渲染，也就没有"打开即列最近会话"。
- 没有预览。

### 1.3 客户端能拿到的会话数据

`ctx.sessions.list` 是快照 store（`dsh-api-session-controller/lib/client.js:3166-3171`）：

```
{ ids, byId, phase, projectionsBySession }
```

行字段（`projectList`，`:3497-3516`）—— **注意没有 createdAt、没有 archived/pinned**：

| 字段 | 说明 |
| --- | --- |
| `id` | SessionId（string） |
| `displayTitle` | `title` → cwd basename → id 兜底（`displayTitleOf` `:3052-3059`） |
| `title?` | 仅当 title projection 非空 |
| `running` | Agent 正在跑 |
| `blank` | 从未有过 `turn/start`（就是那个"新会话"占位行） |
| **`updatedAt`** | **= `max(summary.updatedAt, lastPromptAt)`；Host 侧 = `max(header.createdAt, lastPromptAt)`** |
| `cwd?` | 工作目录 |
| `parentId?` / `origin?` / `depth` | 血缘 / `'subagent'` / 层级 |
| `retainedBy` | 引用计数，如 `{ mainView: 1 }` |
| `projectionValues?` | **所有 wire projection 的值**（预览就靠它） |

> ⚠️ **`updatedAt` 不是"最后活动时间"，是"最后一次用户输入（或创建）时间"。**
> agent 回复**不会**推进它。所以单看 recency 会骗人 —— 一个 agent 刚回复完、
> 但你两小时前才发过消息的会话，`updatedAt` 显示的是两小时前。
> 这条直接决定了 §4.3 的排序设计。

归档 / 置顶在**另一个 store**：`useWorkspaces` → `{ items, archivedSessionIds, pinnedSessionIds }`
（`dsh-workspace/lib/types/spec.js:46-54`，Host 持久化，`workspace` 域 version 2）。
归档语义（已核实）：默认不显示、**不能打开**、不能跑模型步骤，但保留它在工作区里的位置；归档与置顶互斥。

状态 hooks 由 `dsh-client-ui-session/lib/client.js:469-475` 提供：

```
useSessionStatus(id) → { running, pendingInteraction: {kind}, completionUnread }
```

`pendingInteraction.kind` ∈ `approval` / `plan-review` / `question`。
**`completionUnread` 是纯内存的**（`:141` 一个 `Set`），刷新即丢，打开会话即清 —— 所以它只能当瞬时徽章用。

> ⚠️ **`list.ids` 是原始 store，不是"会话列表"。**
> 它同时装着**每一次子 agent 运行产生的 session**（`origin: 'subagent'`）、
> blank 占位行、以及归档项 —— 侧边栏用 `sessionVisible()` 把这三类全过滤掉。
> 实测：`ids.length` 是 1531，而面板真正能列出、也真正该报给用户的数字要小得多。
> **任何「共 N 个会话」的展示都必须走同一套分类**，否则会把用户根本看不到的东西数进去。
> 这正是第一版页脚把 1531 打出来的原因。

### 1.4 可用的服务

| 服务 | 用得到的 |
| --- | --- |
| `ctx.uiWorkspace` | `openSession(target)`、`openWorkspace(id)`、`startSession(workspaceId?)`、`archiveSession`、`unarchiveSession`、`pickDirectory` |
| `ctx.sessions` | `search(q, signal)`、`retain`、`using`、`retainInfo`、`refreshProjections` |
| `ctx.workspaces` | `list` 快照；`archiveSession` / `unarchiveSession` |
| `ctx.shortcuts` | `register`、`registerFixed`、`observeFixedInput`、`catalog`、`config`、`edit` |
| `ctx.slots` / `ctx.locale` / `ctx.layout` | 注册 UI / 本地化 / `selectPanel` |

> `ctx.shortcuts` **不在** Client inspect 目录里（目录只有 layout, locale, sessions, slots, theme, timer, uiWorkspace, workspaces），
> 但确实存在且可注入 —— `dsh-client-ui-workspace/lib/client.js:4108-4117` 的 `inject` 里就有 `"shortcuts"`。

---

## 2. 抢占 `⌘K`：四条路，按干净程度排

这是整个方案唯一的硬约束。规则在 `dsh-client-shortcuts/lib/client.js`。

### 走不通的

**① 重新注册 `session.search`** → `:589` 抛 `Duplicate shortcut command: session.search`。
**没有任何 unregister / disable / shadow 别人命令的公开 API**（disposer 被硬绑定到调用者自己的对象，`:607-611`）。

**② 自己注册一个默认 `primary+KeyK` 的可配置命令** → `:600-603` 抛
`Conflicting shortcut defaults: … and session.search (desktop:macos)`。
关键陷阱：**注册时只比较"默认键位"，完全无视用户覆盖**，所以"先把 session.search 清掉再注册"**也没用**。

**③ 直接在用户的按键偏好里写 `set session.search → null` 然后注册** → 同上，注册这一步还是会被默认值撞死。

### 走得通的

**④ `registerFixed()` + `observeFixedInput()`** —— 官方 API，**零偏好写入**，桌面端和 Web 都成立。

`registerFixed`（`:554-563`）**没有冲突检查**：

```js
registerFixed(command) {
  if (this.fixedCommands.has(command.id) || this.commands.has(command.id))
    throw new Error(`Duplicate shortcut command: ${command.id}`);
  for (const binding of command.bindings) normalizeBinding(binding, this.platform);
  this.fixedCommands.set(command.id, command);   // ← 没有 overlap 检查
  …
}
```

它为什么能生效，是一条完整的链：

1. 固定键位进入 `effectiveShortcuts` 的 `fixed.filter(...)` 项（`protocol.js:267`），
   而这一项**没有 `modified` / `issue` 条件** —— 于是 `session.search` 被判为 **conflicted**，失效。
2. 失效让 Electron 主进程的**原生拦截集合**把它排除：`lib/main.js:10385` 只收集
   `binding !== null && issue === null && conflicts.length === 0` 的行。
   → **Electron 不再 `preventDefault` ⌘K**，DOM keydown 于是真的到达渲染进程。
   （固定键位本身**从不**被原生拦截，这是设计如此。）
3. 渲染进程的键盘处理器**先喂 fixed 观察者，再做可配置派发**：

   ```js
   // client.js:807-818
   fixed?.({ type: "keydown", gesture, context, consume });
   if (native) return;                     // 桌面端到此为止
   shortcuts.dispatch({...gesture, defaultPrevented: event.defaultPrevented}, context, consume);
   ```
4. 我们的观察者拿到 gesture，调 `input.consume()`（→ `event.preventDefault()`），打开面板。
5. **Web 端也不会被吞**：`dispatch` 第一行就是
   `if (gesture.defaultPrevented || gesture.composing) return { status: "pass" };`（`:661`）。

**收益**：不写任何用户偏好；桌面上还能顺带拿到原生优先级（`priority` 绑定绕过 modal/region 门控，`:678-679`）。
**代价**：① `session.search` 变成"冲突/不可用"（在快捷键列表里仍然可见，只是不可执行、`aria` 丢失）；
② 固定行的键位**用户不可重新绑定**。

**⑤ ④ + 把 `session.search` 挪到另一个键**（用 `ctx.shortcuts.edit()` 写一次偏好）。
这样侧边栏搜索仍然有一个键盘入口（比如 `⌘⇧K`），而且 `session.search` 不再冲突 → 恢复正常。
写一次用户按键文件，可被 Settings → **Restore All** 整体还原。

**⑥ 只用 `edit()` 两步**（先清空 `session.search`，再把自己设成 `⌘K`）：
能拿到一个**正常的、用户可重绑的**目录行，代价是两次偏好写入 + 两次 revision 往返。
（顺序不能反：先设自己会返回 `status:'conflict', conflicts:['session.search']`。）

### 采用方案

按你的意见 —— **插件里给一个开关，默认开启覆盖系统快捷键**：

- Config 字段 `takeOverK: boolean`，**默认 `true`**。
- 开启时走 **④** 拿 ⌘K（零写入）；再走 **⑤** 把侧边栏搜索挪到 `⌘⇧K` 保留可用性。
- 关闭时不注册固定键位，用一个**没有默认键位的普通命令**，由你在设置里自己绑。
- 无论开关如何，都**同时**注册一个无默认键位的可配置命令 —— 这样高级用户可以额外加一个自己顺手的键，
  而且固定键位"不可重绑"这个缺点有了出口。
- 只在两个前置条件都成立时才动手（防呆 + 优雅降级）：
  ① `session.search` 在 catalog 里、`modified === false`、确实绑着 `primary+KeyK`；
  ② 我们自己的命令没有覆盖。任一不成立就静默跳过。
  这样上游万一改名了，插件自己的键位仍然可用，不会崩。

> **施工红线**：固定命令的 id **必须带点** —— `/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u`（`protocol.js:130`）。
> id 不合规会让桌面端 `shortcutsGet` 拒绝整份定义，`syncDefinitions` 的 rejection 分支把
> config 状态置为 `unreadable`，于是**整个快捷键系统静默失效**。用 `session-palette.toggle` 这种形如 `a.b` 的 id。

---

## 3. 落点：`shell.overlay`

live inspect 结果：

```json
{ "name": "shell.overlay", "kind": "list", "scope": "root", "replaceRisk": "none",
  "registration": [ { "name": "id", "type": "string", "required": true },
                    { "name": "order", "type": "number", "required": false },
                    { "name": "label", "type": "string | (() => string)", "required": false } ] }
```

槽位自述（`dsh-cordis-client-runner/lib/client.js:4820`）：

> Frame-wide floating layer, above every column and outside their scroll containers. …
> The layer itself is **click-through — entries opt back into pointer events** …
> This is the **additive seat** for a frame-wide surface of your own.

它的现存占用者里就有你装过的插件（`dsh-plugin-copy-session-id.toast`），模式已被验证。
渲染位置：`dsh-client-ui-layout` 的 `overlayLayer`，CSS 是 `position:absolute; inset:0; z-index:20; pointer-events:none`，
子元素 `pointer-events:auto`。

> 顺带说明：`react-dom` 在 seed 模块表里，技术上插件可以自己 `createPortal(document.body)`。
> 但官方 practices 明确写着 *"Do not write DOM outside your component or append to `document.body`"*，
> 而且 `shell.overlay` 天然拿到正确的层叠顺序与主题继承。**走槽位。**

### 3.1 组件 props

`dsh-client-ui-renderer/lib/client.js:646-657` 的 `materializeStandardBinding` 把 root 级标准 hook 摊进 props。
`shell.overlay` 的标准 props 是 `useResource / useWorkspaces / usePanelInfo / useSessions /
useSessionStatus / useSessionRetainInfo`。加上注册时 `locale: NS` 带来的 `t`：

```js
function Palette({ useSessions, useWorkspaces, useSessionStatus, usePanelInfo, t }) { … }
```

---

## 4. 设计

### 4.1 结构

```
        ┌───────────────────────────────────────────────────────────┐
        │  ⌕  搜索会话…                              ⌘K      esc      │
        ├───────────────────────────────────┬───────────────────────┤
        │  需要你                           │  Fix plugin README    │
        │  ▸ 修复插件 README          ●审批 │  dsh-plugin-theme-…   │
        │                                   │  ⏳ 等待审批           │
        │  活跃                             │  ───────────────────  │
        │  ▸ 迁移到 bun               ●运行 │                       │
        │  ▸ 重构 palette             ●未读 │  你：                  │
        │                                   │  把 README 按 tailscale│
        │  今天                             │  那套规范重写一下…      │
        │  ▸ Fix plugin README              │                       │
        │    dsh-plugin-theme-workbench     │  DSH：                 │
        │    2 小时前                       │  已完成。45/45 通过，  │
        │                                   │  tag 已重打到 main…    │
        │                                   │                       │
        │                                   │  ⏎ 打开   ⌘⇧A 归档     │
        └───────────────────────────────────┴───────────────────────┘
```

- 居中，宽 `min(920px, 92vw)`，高 `min(560px, 78vh)`；左列结果（约 58%）+ 右列预览（约 42%）+ 一条 hairline。
- 底部 keycap 提示条，用 `--dsw-alias-*` 画，不引图标字库。
- **打开时不是空白** —— 直接列最近会话，按 §4.3 排序分桶。这是"像 Spotlight"的关键：
  ⌘K 之后不打字就能用方向键跳会话。

### 4.2 查询语言（前缀式）

| 语法 | 含义 |
| --- | --- |
| `随便什么字` | 标题 + 工作区名（本地模糊，即时）＋ 消息内容（250ms 防抖，Host） |
| `@名字` | 限定工作区（对工作区标题模糊匹配） |
| `is:archived` `is:pinned` `is:running` `is:unread` `is:waiting` `is:blank` | 状态筛选 |
| `after:` / `before:` | 时间范围，支持 `2026-10-01` 与相对简写 `7d` / `2w` / `1m` |
| 前缀 `-` | 取反，如 `-is:pinned` |

先把 token 切出去，剩下的才算文本词（`@foo bar` = 工作区 foo 里含 bar）。
解析结果渲染成输入框下方一排**可删 chip**；输入框为空时按 `⌫` 删最后一个 chip。
这样用户永远看得见当前生效的筛选。

**决策**：不做按钮式筛选栏。你举的三个维度（工作区 / 日期 / 归档）以及额外的状态位，
全都能被 typed prefix 干净表达，而面板要保持轻。

> 现成可加但暂不做（数据都在 `projectionValues` 里，零 I/O）：
> `model:`（`modelSelection.lastUsed`）、`has:goal`（`goal.phase`）、`has:plan`（`plan.active`）、
> `has:todos`、`has:subagents`（`subagentCatalog`）、`is:over-budget`（`contextPressure`）。
> 这些留成 Phase 5 的可选项。

### 4.3 排序与分组 —— 默认视图按「活跃度」优先

**这一节是被两条事实逼出来的**：

1. `updatedAt` 只反映**最后一次用户输入**，agent 回复不推进它；
2. 你指出的：会话有 active 状态 —— 正在跑、agent 刚回复、回复了但未读。

所以纯按 recency 排是**错的**：一个 agent 正在跑、或在等你审批的会话，可能因为
"你最后一次发言是两小时前"而沉到列表中部。默认视图必须把活跃的顶上来。

**默认视图（「最近」）的分组顺序**：

| 分组 | 条件 | 组内排序 |
| --- | --- | --- |
| **需要你** | `pendingInteraction !== undefined`（审批 / 计划复核 / 提问） | `updatedAt` 倒序 |
| **活跃** | `running === true` 或子 agent 在跑，或 `completionUnread === true` | 先按状态分层（运行中 → 未读），再 `updatedAt` 倒序 |
| **今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早** | 其余（**包含置顶项**） | `updatedAt` 倒序 |

- 「需要你」置顶的理由：那是**唯一被阻塞、只有你能推进**的一类，最可行动。
- 「运行中」排在「未读」前面：前者还在动，后者已经停下来了。
- 有查询时**不做特殊分组**，只在扁平结果里让活跃项优先，保持结果可预期。

#### 抽屉式视图：`Tab` 在三个「问题」之间切换

**这里我先做错了一版，值得记下来。** 第一版把置顶做成默认列表里的一个「已置顶」分组，
理由是"怕忘了 = 不输入也该看得见"。用户在实机上看了一眼就纠正了：

> 「PIN 只是怕忘了，但不一定真的重要一定要看到。而且很久前的 PIN，和现在没关系，
> 它更像一个**收藏抽屉**。」

这个纠正一刀切中要害。实机截图里那条 `讨论创业 · 25d` 被顶在 TODAY 之上 —— 一个 25 天前的
标记和今天没有任何关系，占着首屏就是噪音。**「怕忘了」的意思是「必须找得到」，不是「必须一直看见」。**

而一旦抽成「抽屉」这个模式，它就自然推广到**归档**。归档比置顶更缺：在此之前归档项在面板里
**完全进不去**，`⌘⇧A` 只能归档、永远无法恢复。

所以最终是**三个视图**，`Tab` 向前循环、`⇧Tab` 向后：

| 视图 | 回答的问题 | 内容 | 排序 |
| --- | --- | --- | --- |
| **最近**（默认） | 现在在发生什么 | 全部非归档会话 | 需要你 / 活跃 / 时间桶 |
| **置顶** | 我留下过什么 | 置顶项 | **置顶顺序**（最近置顶在前） |
| **归档** | 我收起来过什么 | 归档项，行变暗 | `updatedAt` 倒序 |

关键点：

- **每个抽屉的计数就是提醒**。切换器上写着「置顶 1 ｜ 归档 16」，你不会忘记里面有东西；
  但抽屉不占首屏。
- **抽屉成员完全不影响「最近」的排序** —— 既不抬升也不下沉，连查询时的 tie-break 都不给。
  这是"它只改变*在哪里找到*，不改变*多重要*"最干净的实现。
- **抽屉里也能搜**：切换视图**不清空查询**，每个抽屉有自己的过滤。
- **归档视图让 `⌘⇧A` 双向可用** —— 进去就能恢复（`uiWorkspace.unarchiveSession`）。
- **打开某个视图时不再把它自己的内容报成"已隐藏"**：归档视图里 `archivedHidden` 归零，
  否则会一边列着 16 条一边说"已隐藏 16 个"。
- **归档行不能打开**（上游规则）：行变暗、预览写明「归档会话不能直接打开，按 ⌘⇧A 恢复」，
  Enter 拒绝并给同一句提示。注意 `ctx.uiWorkspace.openSession()` **自己不做归档检查**
  （检查在上游 UI 层的 `guardedOpen`），所以这个守卫必须在我们这边。
- **`Tab` 的取舍**：宿主自己的 `/` 菜单里 Tab 是"接受当前项"，但本面板里 Enter 已经是唯一的
  打开手势，Tab 接受就是冗余的。而拦截 Tab 还顺手补掉一个 a11y 漏洞 ——
  面板原本没有焦点陷阱，Tab 会把焦点漏到遮罩后面去。
- **可见的切换器**，不是纯隐藏快捷键：鼠标用户不用学快捷键也能进抽屉。
- `⌘⇧P` 切换高亮行的置顶。上游**根本没有**置顶快捷键（侧边栏只能鼠标点行菜单），
  所以这是置顶第一次有键盘入口。
- **置顶与归档互斥**：上游规定「archiving drops the session's pin」，所以归档一个置顶会话时
  提示语改成「已归档（置顶已移除）」，否则一个标记会无声消失。

> 命名仍用「置顶 / Pinned」「归档 / Archived」而不是「收藏」，因为侧边栏的行菜单里就叫这个。
> 心智模型可以是抽屉，但**词汇要和宿主保持一致**。

> **这个模式值得记住**：当一个维度是「跨时间的个人标记」而不是「当下的状态」时，
> 它就不该混进按时间/活跃度排的主列表 —— 做成一个**带计数的可切换视图**。

**已知局限（必须写进 README）**：`completionUnread` 是个 `Set`，**不带时间戳**，
所以「刚完成」组内无法按"完成时刻"精确排序，只能靠分层 + `updatedAt`。
Phase 5 可以加一个**内存观察时钟**：插件自己记录"我第一次看到它变成 running/unread 的时刻"，
用这个排序会比 `updatedAt` 更贴近直觉（刷新后重置，可接受）。

**查询结果排序**：本地命中在前（按下面的模糊分数），Host 内容命中在后，各自去重。

**匹配**：本地元数据用**模糊**匹配，不再用上游的子串匹配。

宿主自己有一份干净的排序器：`dsh-client-ui-primitives/lib/index.js:7999` 的
`alignmentScore(name, query)`（有序子序列打分 + 词边界加分）与 `:8036` 的 `rankByName(items, query)`，
排序规则 `前缀优先 → 分数 → 原始顺序`（`:8058`）。`ui-commands` 的 `/` 菜单用的就是它。

我们不能 import（§0），但这两个是**无依赖纯函数**，按官方指示抄进插件即可。
抄过来之后面板的搜索手感与宿主 `/` 菜单**完全一致**，顺手补掉上游自己承认的
Known Limitation（"No fuzzy content search"）里属于元数据的那一半。

> 注意：`rankByName` 只返回重排后的数组，**不返回匹配区间**；`alignmentScore` 也没有导出，
> 而且要**自己实现高亮**（整份客户端 UI 里没有任何 `<mark>` / Highlight 组件）。
> 高亮是我们要额外写的一点（把 query 按有序子序列在标题上标出命中位置）。

### 4.4 预览窗格（"polish" 的来源）

**数据来源：`turnOutline` projection，通过 `byId[id].projectionValues.turnOutline` 直接取。**

`dsh-session-turn-outline/lib/index.js`：

```js
wire: { viewSchema: turnOutlineEntriesSchema,   // Array<{ turn, seq, prompt, response }>
        view: state => state.turns }
```

`prompt` ≤50 code points，`response` ≤120 code points，**每个 turn 一条**。

**为什么它是免费的**（已核实的链路）：

- 冷会话：Host 列表用 `get('sessionProjectionCache').cachedSnapshot(header)`（`dsh-api-session-controller/lib/types/list.js:248-260`），
  不带 `keys` 参数 → 返回**每个注册了 `wire` view 的 projection unit**（`dsh-session-projection-cache/lib/index.js:193-199`）。
  这是官方说的"零 I/O 列表读"。
- 热会话：`hintsOf('sequenced', sessionProjections.cachedSnapshot(session))`，并有 per-session projection 帧流式推送。
- projection cache 在 `turn/end`、会话创建、dispose 时**强制写入**（`dsh-session-projection-cache/lib/index.js:295-317`）。

所以：**最近一个已完成 turn 的预览文本，在首次 `session.list` 之后就已经在内存里了。**
鼠标划过、键盘上下移动，都**不发任何请求、不 loading、不闪**。这就是"polish"的技术来源。

> **反面**：如果某个会话的 projection 恰好缺失，`ctx.sessions.refreshProjections(id)` 对**冷会话**
> 会做一次完整的 JSONL 读 + 全量 projection fold，LRU 容量只有 5（`dsh-session-query/lib/index.js:335, 358-380`）。
> 可能是几十毫秒到几秒。**绝对不要 per-hover 调用。** 需要时只在面板打开时按有限并发预取，并缓存。

**窗格内容**：

1. 标题（`displayTitle`）+ 工作区名 + 相对时间
2. 状态徽章：归档 / 置顶 / 运行中 / 待审批 / 待回答 / 未查看完成
3. hairline
4. `你：{prompt}` / `DSH：{response}`（最后一个 turn）
5. 若本次是**内容命中**，追加命中片段 `snippet`
6. 底部操作提示

**渲染方式**：因为拿不到（也不该拿）宿主对非当前会话的会话渲染器，
预览走「纯文本 + 我们自己的一点排版」这条便宜且可辩护的路：
把 `prompt` / `response` 当纯文本渲染（它们本来就是折叠空白后的单段预览文本），
`whitespace: pre-wrap` 处理换行，超长截断。**不引入 markdown 渲染器**。

> 这是刻意的取舍：`ui-conversation` / `ui-chat` / `ui-trajectory` 不是 seed 模块，
> 而且 ui-primitives README 明说"A plugin cannot import another plugin's component"。
> 要在预览里渲染完整 turn（markdown + 工具卡片）就得自己实现一遍，成本远超收益。

> **已实测（Phase 0, P1）：只覆盖 66%。** 1527 个会话里 1007 行有非空 `turnOutline`，
> 8 行是空数组（blank 会话），**512 行根本没有这个 key**（只剩 `title`）。
> 链路对"有缓存的会话"成立，但缓存并非覆盖全部 —— 缺的恰好是旧会话。
>
> 所以高亮行必须**懒加载**：`turnOutline` 缺失且该行被高亮停留 ~200ms 时，
> 调 `ctx.sessions.refreshProjections(id)`，**同一时刻只允许一个请求在飞**，拿到就缓存。
> 箭头快速滚动不触发（防抖），只有停下来才请求。这是可接受的成本，
> 因为冷读是一次 JSONL 全量读（LRU 容量 5），而我们一次只读一行。
> 加载期间该区域显示 shimmer 占位，**不能让窗格高度跳动**（那正是它要避免的"不 polish"）。

### 4.5 键盘与鼠标

| 输入 | 行为 |
| --- | --- |
| `↑` `↓` | 移动高亮，循环 |
| `Home` `End` | 首 / 末 |
| `PageUp` `PageDown` | 翻页（滚动容器） |
| `Enter` | 打开高亮会话 |
| `Esc` | 关闭 |
| `⌘K` | 关闭（toggle 语义；见下） |
| `⌫`（输入为空） | 删最后一个筛选 chip |
| `⌘⇧A` | 归档 / 取消归档高亮会话 |
| `Tab` | 焦点在输入框 ↔ 关闭按钮之间（可访问性），**不做筛选切换** |

**硬约束**：`Escape` / `Tab` / `Space` / `Backspace` / `Delete` / 四个方向键 / 无修饰的 `Enter`
**都不能注册为全局快捷键** —— `bindingIssue` 对它们返回 `"reserved"`，注册会抛 `Reserved shortcut default`。
所以这些键**必须**由面板内部的 React handler 处理（这本来也是对的）。

**hover 与键盘共用一个高亮**：只有一个 `activeId`。鼠标 `onMouseEnter` 设为该行，键盘移动同时滚动进视野。
这与宿主 `/` 命令菜单的既有做法一致（`dsh-client-ui-commands/lib/client.js:1297-1299`：
`onMouseEnter: () => popup.highlight(index)`）。预览永远跟着它走，不会出现两个高亮打架。

**其余从宿主抄来的交互惯例**（已逐条核对过实现）：

- 宿主内部有两套并存的键盘约定：`Menu` 原语走 **DOM focus 游走**（且 hover **不**移动焦点）；
  `/` 菜单与 popupSelect 走 **单一 highlight 索引 + focus 留在输入框**。
  全屏面板属于后者 —— **抄 popupSelect，不要用 `Menu` 原语**（它需要 anchor、portal 定位、走 DOM focus）。
- 方向键**环绕**：`const active = (s.active + dir + rows.length) % rows.length`（`ui-commands:528`）。
- **打字把高亮重置到第一行**（`setSearch` 写 `active: 0`，`ui-commands:509-517`）。
- 高亮行滚入视野：`querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })`（`ui-commands:1235-1242`）。
- 打开时焦点自动落到搜索框（`ui-commands:1258-1260`）。
- **`Home` / `End` 在 popupSelect 里没有，但 `Menu` 原语里有** —— 作为既有先例，我们加上是合理的。
- `Esc` / `Shift+Tab` 一律是"退出"，**绝不**顺带提交或改写草稿（`ui-input-trigger` README 明确写了这条原则）。
- 宿主**没有** modal 打开时锁 body 滚动的实现（已核实为全局缺失）。我们也不锁，保持一致。

**`⌘K` 的 toggle**：注册固定键位时，`registerFixed` 不能带 resolve 回调，所以"再按一次收起"
由面板**自己的** keydown handler 处理（面板打开时它持有焦点）；同时那条**无默认键位的可配置命令**
的 `resolve` 写成 toggle（开着就关，关着就开），供用户在设置里绑了别的键时使用。
桌面端 `priority` 会绕过 modal 门控，所以两条路都能到我们这里。

### 4.6 归档行

- 默认**不显示**归档会话（对齐侧边栏默认的 `Hide archived`）。
- 显式切换（`is:archived` 或 chip）后才出现，行变灰 + "已归档"徽章。
- **`Enter` 不给打开** —— 上游明确拒绝打开归档会话，且 `ctx.uiWorkspace.openSession()`
  **内部没有任何归档检查**（检查在 UI 层 `guardedOpen` `:2816-2822`）。
  所以我们必须**自己 guard**：归档行上按 Enter 弹一句"已归档，恢复后即可打开"，
  并提示 `⌘⇧A` 就地恢复（`uiWorkspace.unarchiveSession`）。恢复后行变为可打开，面板不关。

> 这是一条容易漏掉的一致性缺口：直接调 `openSession` 会**静默打开**归档会话。

### 4.7 视觉

**沿用 theme-workbench 已确立的做法**（也是 practices.md 的要求）：只 `require('react')`，
**不 require 任何宿主客户端包**（`ui-primitives` 虽然在 seed 表里、技术上可 require，
但官方明令不要，而且 theme-workbench 已经证明不 require 也能做到 97 个 token 的完整贴合）。
需要的控件行为与 CSS 都**抄进插件**，只留 token 这一层共享依赖。

**具体 token**（定义在 `ui-theme/lib/client.js` 内联的 CSS 里）：

| 用途 | token |
| --- | --- |
| 遮罩 | `--dsw-alias-bg-mask-1`（亮 `#0000003d` / 暗 `#00000080`）—— **不要**纯黑 `rgba(0,0,0,.5)`，米白底下会脏 |
| 面板表面 | `--dsw-menu-surface-fill`（亮 `#f8f9fa94` / 暗 `#43454a73`）；darwin 用 `--dsw-specific-menu`（近不透明） |
| 磨砂 | `--dsw-menu-backdrop-filter`（`blur(40px) saturate(150%)`） |
| 组标题（sticky） | `--dsw-alias-menu-group-header-fill`（94% 不透明） |
| 阴影 | `--dsw-elevation-prominent`；描边 `--dsw-elevation-stroke` + `--dsw-elevation-stroke-color` |
| 圆角 | `--dsw-radius-panel`（28px） |
| 边框 | `--dsw-alias-border-l1`（亮）/ `--dsw-alias-border-l3`（暗） |
| 文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 高亮行 | `--dsw-alias-interactive-bg-hover`（选中态也用它，宿主从不做逐字 mark） |
| 滚动条 | 抬升表面要**在自己的容器上重绑** `--dsh-scrollbar-thumb` → `--dsw-alias-scrollbar-bg-l2`（及其 hover） |
| 帧内边距 | `--dsh-frame-overlay-top` / `--dsh-frame-top-clearance`(48px) —— macOS 红绿灯与窗口 chrome 的高度，面板的 `max-height` 要避开 |

**z-index**：宿主没有统一的层管理服务，每个组件硬编码自己的数字 ——
`shell.overlay` 层是 **20**，锚定菜单/提示 100，`Modal`/Lightbox 1000，portal 出去的菜单/toast 1100。
我们待在 `shell.overlay` 里就够了，**不要自己设 z-index**（层已经在所有列之上且不受其滚动容器影响）。
将来若要加锚定小弹层，再照 100 那一档处理。

**CSS 注入**：一个模块级 CSS 字符串 + 一个带标记的 `<style>` 标签，
在 `ctx.effect` 里插入、卸载时移除（`document.head?.appendChild`，并对无 document 的环境做守卫）。
类名统一 `.dsp-*` 前缀。

**已知缺口**：`docs/web-styling.md`（README 反复引用的"权威样式规则"）**不在 app.asar 里**，
只有引用没有正文。所以规则是从 `ui-theme` / `ui-primitives` 的 README + 真实 CSS module 反推的。
如果以后拿到源仓库，值得回头核对一遍。

亮 / 暗 / **米白** 三套都要过一遍。这是你的验收标准。

### 4.8 可访问性与"模态仲裁"

**硬性要求**：根元素 `role="dialog"` + `aria-modal="true"`。

不只是 a11y —— 宿主用它做全局面板仲裁：

```js
// dsh-client-ui-primitives/lib/index.js:3670
const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]';
```

- `useModalLayer`（`:3703-3754`）维护 per-document 的 layer 栈，**只有栈顶**拿到 `Escape` 和 `Tab`。
- `closeTopModal`（`:3677`）只关文档里**最后一个**匹配元素。
- 快捷键服务读这个选择器，对未声明该 modal 作用域的命令返回 `{status:'blocked', reason:'modal'}`。

要抄的 `useModalLayer` 行为（不能 import，自己实现一份）：

1. per-document layer 栈，只有栈顶响应 `Escape` / `Tab`。
2. `Escape` 带 `ctrlKey/altKey/metaKey` 时忽略；`event.repeat` 不重复触发关闭。
3. Tab 焦点陷阱在首尾循环，跳过 `[inert]` / `[hidden]` 内的元素。
4. 打开时记住 `document.activeElement`，关闭时**还原焦点**。
5. 初始焦点用 `[data-modal-autofocus]` 标记；程序化聚焦不显示 focus ring。
6. 输入法组合期（composition）不处理按键。

外加 combobox 语义：输入框 `role="combobox"` + `aria-expanded` + `aria-controls`，
列表 `role="listbox"`，行 `role="option"` + `aria-selected`，
`aria-activedescendant` 指向高亮行 —— **焦点始终留在输入框**，只移 activedescendant。

### 4.9 指针事件

`shell.overlay` 的层是 `pointer-events:none`，其直接子元素自动 `pointer-events:auto`。

- **关闭时组件 `return null`** —— 绝不能留一个透明遮罩吃掉点击。
- 打开时根容器铺满（`inset:0`）作为居中容器 + 遮罩；遮罩点击关闭。
- 面板本体 `stopPropagation`，点内部不关。

---

## 5. API 映射表

| 需要做的事 | 调用 |
| --- | --- |
| 会话列表 | `useSessions(s => s)` → `ids` / `byId` / `projectionsBySession` |
| 最后 turn 预览 | `useSessions(s => s.byId[id].projectionValues.turnOutline)` |
| 归档 / 置顶集合 | `useWorkspaces(s => s)` → `archivedSessionIds` / `pinnedSessionIds` |
| 运行 / 待交互 / 未读 | `useSessionStatus(id)` |
| 内容搜索 | `ctx.sessions.search(query, signal)`（250ms 防抖 + AbortController） |
| 打开会话 | `ctx.uiWorkspace.openSession(id)` —— **先自己检查 archived** |
| 归档 / 恢复 | `ctx.uiWorkspace.archiveSession(id, {stopActivity})` / `unarchiveSession(id)` |
| 新建会话 | `ctx.uiWorkspace.startSession(workspaceId?)` |
| 抢 ⌘K（默认） | `ctx.effect(() => ctx.shortcuts.registerFixed({ id:'session-palette.toggle', bindings:[{code:'KeyK',modifiers:['primary']}], keys:['⌘K'], group:'application', label:()=>t('open') }))` + `ctx.shortcuts.observeFixedInput(fn)` |
| 保留侧边栏搜索 | `ctx.shortcuts.edit({type:'set', id:'session.search', binding:{code:'KeyK',modifiers:['primary','shift']}}, rev)` |
| 读当前键位 | `ctx.shortcuts.catalog.getSnapshot()` / `ctx.shortcuts.config.getSnapshot().revision` |
| 注册 UI | `ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay', id:'session-palette', order:…, locale:NS}, Palette))` |
| 本地化 | `ctx.effect(() => ctx.locale.register(NS, {en, zh}))` + 注册时 `locale: NS` |

**注册顺序注意**：`registerFixed` 的冲突判定与注册顺序无关（`protocol.js:236` 的注释明确说了），
但 `edit` 目标必须是**已注册**的可编辑命令，所以 `edit('session.search', …)` 必须在
ui-workspace 挂载之后。用 `ctx.shortcuts.catalog` 轮询/订阅等它出现，出现了再改。

---

## 6. 架构

```
dsh-plugin-session-palette/
├── package.json          # dsh.client { platform:'web', immediately:true, inject:[…] }
├── index.js              # Host 半边：Config（takeOverK / relocateSidebarSearch，均 .volatile()）
├── client.js             # 全部逻辑，手写、不打包（与 theme-workbench 一致）
├── locale/{en,zh}.json
├── cordis.patch.yml
├── assets/icon.svg
├── README.md             # 按 tailscale 那套房屋风格
├── docs/plan.md          # 本文件（不随包发布）
└── tests/plugin.test.mjs # node:vm 跑 client.js：纯函数 + 结构 + 无非法子节点
```

`client.js` 内部分区（每个纯函数单独可测）：

1. **`parseQuery(raw)`** → `{ text, workspace, flags:Set, after, before }`。筛选逻辑的唯一入口。
2. **`alignmentScore` / `rankByName`** —— 从 ui-primitives 抄来的模糊排序器（带出处注释）。
3. **`matchLocal(row, parsed, ctx)`** —— 标题 / 工作区 / flags / 时间窗。
4. **`activityTier(row, status)`** → `0 需要你 | 1 进行中 | 2 未读 | 3 普通`。
5. **`bucketOf(updatedAt, now)`** → 时间桶。
6. **`buildModel(...)`** —— 合成上面 + Host 内容搜索 + 分组排序。
7. **`Palette`** —— 组件，只管画与键盘。
8. **`useModalLayerLite`** —— §4.8 的焦点/Escape/还原焦点。
9. **`takeOverShortcut()` / `releaseShortcut()`** —— §2 的注册与 edit。
10. **CSS** —— 字符串常量，`ctx.effect` 插入一个 `<style>`。

**为什么不上构建工具**：theme-workbench 已验证"手写 `client.js` + `window.__ModuleLoader__.load`"
这条路可行，且 CI 不需要 install。保持一致。

---

## 7. 风险与未知（按重要性排序）

| # | 风险 | 影响 | 怎么证实 / 兜底 |
| --- | --- | --- | --- |
| **R1** | `turnOutline` 只覆盖 **66%** 的会话（旧会话没有） | 预览对三分之一的行空白 —— 而那正是要找的旧会话 | **已实测**。懒加载方案见 §4.4：高亮停留 200ms 才请求、单飞、缓存、占位不跳高 |
| **R2** | ~~`shortcuts` 服务能否解析~~ | — | ✅ **已实测成立**：`resolved via ctx.get("shortcuts")`。附带结论：别遍历这个 Proxy 探测能力 |
| **R3** | 固定键位**不可用户重绑**，且让 `session.search` 显示为冲突 | 用户觉得被绑架 | 由 Config 开关（默认开）兜住 + 同时注册一个无默认键位的可配置命令 + README 写清如何关闭/Restore All |
| **R4** | 固定命令 id 不含点 → 桌面端整份定义被拒 → **快捷键系统静默失效** | 严重且难排查 | 用 `session-palette.toggle`；加单测断言 id 匹配 `commandPattern` |
| **R5** | `openSession()` 不做归档检查 | 静默打开归档会话，破坏一致性 | 自己 guard（§4.6）；加单测 |
| **R6** | `role="dialog"` 面板与宿主 `Modal` 的焦点还原互相打架 | 关闭后焦点丢失 | 严格按 §4.8 实现并实测「打开设置弹窗 → Esc → 焦点」链路 |
| **R7** | `updatedAt` = 最后一次**用户输入**，不是最后活动 | 排序/时间显示会骗人 | §4.3 的活跃分层就是为此；预览里的时间要写"你上次发言"而不是"最后活动" |
| **R8** | `completionUnread` 是内存 Set，刷新即丢、打开即清 | "刚完成"徽章不可靠 | 只当瞬时提示；Phase 5 加内存观察时钟改善组内排序 |
| **R9** | 本地模糊匹配与 Host 字面内容搜索的语义不一致（一个模糊一个不模糊） | 用户困惑"为什么标题匹配到了内容没匹配到" | 在结果里**标注命中来源**（标题 / 工作区 / 内容） |
| **R10** | 无浏览器控制工具 | 视觉/交互只能由你验收 | 给一份自检清单（亮/暗/米白、⌘K、hover 预览、Esc、归档行、焦点还原） |
| **R11** | 匹配高亮**必须从零写** —— 客户端 UI 里没有任何 `<mark>` / Highlight 组件，`alignmentScore` 也没导出 | 工作量与"看起来像宿主"的差距 | 自己写一个**同时返回命中区间**的有序子序列匹配器（不能照抄 `rankByName`，它只返回重排结果） |
| **R12** | `docs/web-styling.md`（权威样式规则）**不在 asar 里** | 样式可能偏离官方契约 | 已从 `ui-theme` / `ui-primitives` README + 真实 CSS module 反推出 §4.7 的 token 表；拿到源仓库后回头核对 |

---

## 8. 分期

**Phase 0 — 可行性钉子（半天）**
三个各自独立的最小插件，验完就删：
1. 往 `shell.overlay` 注册一个 `role="dialog"` 面板，能开能关。
2. 打印 `Object.keys(byId)` 与有 `turnOutline` 的行数对比（**R1**）。
3. 用 `registerFixed` + `observeFixedInput` 抢 ⌘K，确认桌面端真的收到 DOM 事件（**R2/R4**）。

> 目的是：**在写 UI 之前，把三个"可能白做"的前提钉死。**

**Phase 1 — 能用的面板**
开关、最近会话、活跃分层分组、↑↓ Enter Esc、打开会话、归档 guard。

**Phase 2 — 查询语言**
`@工作区`、`is:*`、`after:` / `before:`、chip 显示与 `⌫` 删除、命中来源标注。

**Phase 3 — 预览窗格**
`turnOutline` 最后一段 + 状态徽章 + 命中片段 + 标题高亮。

**Phase 4 — 快捷键接管与设置**
Config 开关、`settings.general.item` 一行、`⌘⇧A` 归档、`Restore All` 路径、README。

**Phase 5 — 打磨**
更多维度（`model:` / `has:goal` / `has:subagents`）、内存观察时钟、空状态、
动效（尊重 `prefers-reduced-motion`）、亮/暗/米白三套视觉验收。

---

## 9. 决策记录

全部已定，无待确认项。

| # | 决策 | 落点 |
| --- | --- | --- |
| 1 | **⌘K 接管**：插件提供选项，**默认开启**覆盖系统快捷键 | §2 采用 **④ + ⑤**（`registerFixed` 零写入 + 一次 `edit` 保留侧边栏搜索） |
| 2 | **侧边栏搜索**：保留 | 用 `edit` 挪到 `⌘⇧K`；鼠标入口原样不动 |
| 3 | **查询语法**：前缀式 + 可删 chip | §4.2 |
| 4 | **活跃度优先**：默认视图把「正在运行 / 刚回复 / 未读」顶上来 | §4.3 |
| 5 | **「需要你」单独置顶** | §4.3 的分组表（不合并进「活跃」） |
| 6 | **时间文案**：写「你 2 小时前发言」 | §4.4 预览头；理由是 `updatedAt` 只反映用户输入，写模糊的"2 小时前"会骗人 |
| 7 | **先做 Phase 0 探针**，不直接写 UI | §8 |

命名暂定：包 `dsh-plugin-session-palette`，面板「会话面板」。若实施中觉得别扭再改，成本极低。

---

## 10. Phase 0 探针（已完成 ✅）

探针是一个独立的 bundle：`probe/`，已装、已实测、依赖已从 profile 卸载。

> **一处更正（已由用户清理）**：早先这里写的是"环境已还原"，**不准确**——探针的 `link:`
> 依赖确实删掉了，但 profile 的 `cordis.patch.yml` 里留下一行孤立的
> `- id: session-palette-probe`（`disabled: false`，无 `name`）。按宿主 `applyEntryPatches`
> 的代码推导，那会让每次 profile 加载都打一条
> `patch: entry "session-palette-probe" not found`。用户已手工删除该行。
>
> **值得记住的一般结论**：`plugin_manager` 的 `remove_bundle` **不会**回滚它写入 profile
> patch 的启用记录。卸载一个插件后，检查 `cordis.patch.yml` 里有没有剩下孤立的 `- id:`。
它本身不写任何用户偏好 —— 装/卸只影响它自己。

**为什么做成一个而不是三个**：三个问题的答案都靠面板读实时状态。一次安装、一个面板、
一个可运行时开关的 ⌘K 占用按钮，比装/卸三遍省事，而且 **R3 的验证本身就是"按一下 ⌘K 看面板开不开"**。

### 结果

> 探针编号用 **P**，与 §7 的风险编号 **R** 是两套独立编号。

| 探针 | 结论 | 数据 |
| --- | --- | --- |
| **P1** 预览是否已在内存 | ⚠️ **部分成立（66%）** | 1527 会话：1007 行有非空 `turnOutline`；8 行是空数组（blank 会话）；**512 行连这个 key 都没有**（只剩 `title`） |
| **P2** `shortcuts` 服务能否解析 | ✅ **成立** | `resolved via ctx.get("shortcuts")`；`runtime/platform = desktop/macos`；`registerFixed`、`observeFixedInput` 都在；18 个可配置 + 12 个固定行 |
| **P3** 固定键位能否拿到 ⌘K | ✅ **成立（实证）** | `session.search` 变为 `conflicts=[session-palette.toggle]`，随后按 ⌘K **真的唤出了面板** |

**P3 是整个方案的命门，现在它从"推理成立"变成了"实测成立"**：
`registerFixed` 没有冲突检查 → 上游被判冲突 → 从 Electron 主进程的原生拦截集合里消失 →
⌘K 的 DOM 事件活下来 → `fixed` 观察者先于可配置派发收到它 → `consume()` 收下。

### P1 的后果（已并入 §4.4 与 §7）

预览**不能**假设"每行都有"。三分之二免费，**缺的恰好是旧会话** —— 而"翻出很久以前那个会话"
正是面板的主要用途。所以高亮行需要**懒加载**：防抖 ~200ms、同时只有一个请求在飞、拿到就缓存。
单行冷读是一次 JSONL 全量读（LRU 容量 5），只对**当前高亮的那一行**做是可以接受的。

### 附带的可用性清单

探针顺带数出了每个 projection 维度覆盖多少行，这就是 Phase 5 附加筛选的现成依据：

```
title(1527)  permissions(1015)  goal(1015)  tokenUsage(1015)  contextPressure(1015)
contextBreakdown(1015)  inbox(1015)  sessionStats(1015)  turnOutline(1015)
agentPreset(1015)  userQuestions(1015)  subagentCatalog(1015)  subagentTiming(1015)
subagent(1015)  todos(1015)  plan(1015)  modelSelection(1015)
sessionListMetadata(1015)  imageLimits(1015)  messageModel(26)
```

即 `has:goal` / `has:plan` / `has:todos` / `model:` / `has:subagents` 这些筛选对 1015 行可用。
规模参考：**1527 会话 / 16 已归档 / 1 已置顶** —— 本地筛选要按 1500+ 行设计。

### 探针踩到的三个坑（真插件必须避开）

1. **`ctx.slots.register` 必须包在 `ctx.slots.inject(slot, …)` 里**。目标槽未声明时 `register`
   会**抛错**，而 ui-layout 与本插件的 apply 顺序没有约束。这正是 ui-workspace README 强调
   "`ctx.slots.inject()` is required even if the owner is normally present" 的原因。
2. **`ctx.shortcuts` 是 cordis Service Proxy，`Object.keys` 枚举不出方法**（面板里
   `service methods` 一行是空的，但 `registerFixed: yes`）。能力探测必须**按名字直接取属性**，
   绝不能靠遍历。
3. **固定行用 `bindings`（复数数组），可配置行用 `binding`（单数）**。读错字段会让一个
   完全正常的注册显示成 `unbound` —— 当时 `keys` 那栏一直是对的，两栏互相矛盾才暴露出来。
   真插件里以 `keys` 为准做展示。

### 保留

`probe/` **保留在仓库里**，作为这条核心机制的回归验证器：如果将来 DSH 升级改动了
`registerFixed` 的冲突语义或 Electron 的原生拦截集合，重跑一次就能立刻知道，不必重新推导。
它是独立 package（自己的 `package.json`），不会被主包的 `files` 打进发布产物。

复现：`plugin_manager install_bundle` 指向 `probe/` 的绝对路径 → 刷新页面 → 点「Claim ⌘K」→ 按 ⌘K
→ 卸载。**它默认不占用任何快捷键**，只有点了那个按钮才占。

---

## 11. v0.2.0：改名（2026-10-18）

目标：**⌘K 高亮一个会话之后，就地给它改名**，不新开一层界面。

### 11.1 上游到底怎么改名（核对过，不是猜的）

| 结论 | 证据 |
| --- | --- |
| 写入口是**保留引用上的** `rename`，不是服务上的 | `Client Service` 契约：`sessions.using(target, options, op)` → `op(reference)`，`reference.binding.session.rename(title) → RemoteResult<{title, seq}>` |
| 不能直接调 | Host 侧 `SessionTitleService.rename()` 第一句就是 `if (this.ctx.sessions.get(session.id) !== session) throw new Error('session ... is not live in this store')`（`dsh-session-title/lib/index.js`）；`retain`/`using` 的 `open()` 才是让它 live 的那一步 |
| 官方 UI 就是这么做的 | `dsh-client-ui-workspace/lib/client.js:5077`：`sessions.using(sessionId, { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(title))` |
| `source` **不被校验** | `retainScope(id, source)` 只做计数（`retainedBy[source] = (retainedBy[source] ?? 0) + 1`）；类型联合写的是 `controllerOperation | gateway`，而官方自己传了 `workspaceOperation` —— 声明比运行时窄。本插件传 `sessionPalette`，好让 `retainInfo` 里那笔账认得出来是谁 |
| 标题会被**规范化 + 截断** | `normalizeSessionTitle` = 去控制字符、`\s+` 折叠、`trim`、再按 `maxTitleBytes` 截断；`dsh-base` 的 shipped 值 **80 字节**（≈26 个汉字）。空标题抛 `SessionTitleInvalidError('session title must contain visible characters')` |
| 成功即可见 | `ISession.rename` 成功后 `projections.apply('title', …)`，列表行不用等 push 帧 |

### 11.2 交互：为什么复用搜索框，而不是新开一个输入框

候选与淘汰理由：

1. **行内编辑**（`role="option"` 里塞 `<input>`）—— ARIA 里 `option` 的子节点是呈现性的，输入框会从无障碍树里消失；还要和行本身的 `onMouseDown: preventDefault`（保焦点）、`onClick: activate`（会顺手打开会话）打架。
2. **右栏预览标题就地编辑** —— 没有 ARIA 问题，但"在另一个窗格里改这一行的名字"，视线和对象分家了。
3. **✅ 复用顶部搜索框** —— 焦点不动、行高不变、不新增 ARIA 角色冲突；`role` 从 `combobox` 换成 `textbox`（因为它不再驱动列表），`aria-label` 换成"会话标题"。**查询保留**（列表还按原查询筛），高亮保留（所以"在改哪一行"一直是可见的）。

配套的几个"沉默点"是故意写死在这一版里的：

- **种子取 `title`（存储值），不取 `displayTitle`**。未命名会话的 `displayTitle` 会退化成目录名或 id；拿它当种子，用户按一次 ⏎ 就**把派生文本写成了用户数据**。所以行模型里专门带了 `storedTitle`。
- **空草稿不发请求**（host 反正会拒），**与原标题相同则直接退出**（一次 retain 都不花）。
- **IME**：`compositionstart/end` 期间 ⏎ 属于候选词确认，不提交。
- **失败留在原地**：草稿不清、焦点不丢，原因单独一行（`role="alert"`）；提示条里**报 host 实际存下的标题**，而不是草稿 —— 截断/折叠只有在这里才看得见。
- **撤销**：只有原标题非空时才给，否则撤销等于提交空标题。

### 11.3 键位：为什么是 ⌘⇧R

`:disable` 结论全部来自 `lib/main.js` 的 `before-input-event`：

```js
const key = bindingKey({ code: input.code, modifiers })   // code + 精确修饰键集合
const match = keys.has(key)                                // keys = 命令目录的 desktop:macos 默认键位
if (!priority && (main || !match)) return                  // ← 主框架：不匹配 ⇒ 不 preventDefault ⇒ 页面看得见
```

即：**只有命令目录里登记过的组合会被原生吃掉**，其余原样到达 DOM。

| 组合 | 结果 |
| --- | --- |
| `⌘R` | ❌ `page.refresh`（`KeyR` + `primary`，`regions` 含 `editable`） |
| `⌘⌥G` | ❌ host 自己的 `session.rename`（`KeyG` + `primary,alt`） |
| `⌘⇧R` | ✅ 全目录无人占用 → 页面能收到 |
| `⌘⇧⌫` | 已被归档占用（Backspace 是保留键，命令永远拿不到，所以结构上安全） |

已核对的全量键位（`desktop:macos` 默认值）：`⌘B`、`⌘⌥B`、`⌘T`、`⌘P`、`⌘O`、`⌘⌥O`、`⌘,`、`⌘/`、`⌃\``、`⌘\`、`⌘⌥⏎`、`⌘W`、`⌘R`、`⌘⇧.`、`⌘N`、`⌘K`、`⌘⌥G`、`⌘⌥F`、`⌘⇧A`。**这是当前目录的性质，不是承诺**：将来若有人登记 `⌘⇧R`，它会被原生拦走，`rename` 静默失效 —— 这正是 `probe/` 值得留着的原因。

### 11.4 这一版没做的

- **归档会话也能改名**（没加拦截）：改名是元数据操作，不是打开；真被 host 拒了，错误会原样显示在输入框下面。
- **没做字节计数器**：提示条报"实际存下的标题"已经足够诚实，再加一行实时计数属于为 80 字节这一个数字付界面成本。
- **端到端手指验证仍是用户的**：本机沙箱里没有浏览器/ Electron 输入通道，⌘⇧R 真正到手、`rename` 真正落盘，靠的是"静态核对 + 74 条测试 + 你按一次"。

---

## 12. v0.3.0：双击标题改名（2026-10-18）

用户给了一张截图指着会话头部那个标题："这里也能双击改名吗？"

### 12.1 那个标题是什么

`dsh-client-ui-conversation/lib/client.js` 的 `ConversationSessionHeader`：

```jsx
<nav class="…crumbs" aria-label={t('session.hierarchy')}>
  {ancestry.map((summary, index) => {
    const title = last
      ? <span class="…crumb …crumbCurrent">{summary.displayTitle}</span>
      : <button class="…crumb">…</button>
    …
  })}
</nav>
<div class="…headerActions">{renderSlot('conversation.session.header.actions')}</div>
```

| 想做的事 | 能不能用官方槽位 |
| --- | --- |
| 在标题旁边加一个按钮 | ✅ `conversation.session.header.actions`（list，`replaceRisk: none`，已装 agent-preset / subagent-catalog / job-list） |
| **替换标题本身** | ❌ 标题不是槽位，是 header 组件自己画的 `<span>` |
| `conversation.session.header.lineage` | ⚠️ 它**同时**是"子 agent 面包屑标题的替换位"（`renderSlot(…, { fallback: title })`）。占用它就要自己重画那些标题的样式（字号 12/18、颜色、截断），等于复刻宿主 UI |
| 在标题上双击 | ❌ 没有任何槽位包住那段文字 |

所以就地编辑只有两条路：**压一个输入框在标题的盒子上**，或者不做就地。选了前者。

### 12.2 定位与触发

- **触发**：`document` 上的 `dblclick`，`event.target.closest('[class*="crumbCurrent"]')`。
  类名是 CSS module（实际值 `ST7X_W_crumbCurrent`），**哈希会变、后缀不会变**，所以只匹配后缀。
  同一个类名也用在"没选会话时的占位 span"上 —— 那一步由下一个守卫挡掉。
- **是哪个 session**：`retainedBy.mainView > 0`。这是宿主自己回答"当前会话是哪个"的方式
  （`dsh-client-ui-workspace/lib/client.js:89` 的 `current()`、`:3027` 的 `mainSessionId`），
  读同一个标志，插件与侧边栏、`session.rename` 命令不会各有一套"当前"的定义。
- **位置**：`getBoundingClientRect()` 取自那个 span，输入框用 `position: fixed` 压在同一点上
  （宽取 `max(rect.width, 260)`，并按视口右边界收窄）。**header 不重排**，字体/行高/字重照
  `crumbCurrent` 的规则（14/20、500、4px 8px）。
- **为什么不用 `disabled`**：禁用会丢焦点，写到一半就断了；用 `readOnly`。

### 12.3 刻意不碰的东西

- **侧边栏那排会话行的双击**。宿主自己接了（`onRenameRequest` → 它自己的改名对话框）。这里的监听
  在 `closest` 返回 null 时就退出，**不会**和它抢。
- **子 agent 面包屑**。它不是 `crumbCurrent`（是 `crumbSubagent`），双击不改名 —— 想改就从 ⌘K 里改。
- **不注册任何新槽位**：这次只是多了一个 `shell.overlay` 条目（`session-palette.title`，order 940），
  所以它有自己的挂载/卸载生命周期，和面板、toast 平级。

### 12.4 诚实边界

类名后缀是这一版**唯一**依赖宿主 DOM 结构的地方。DSH 若改了 `crumbCurrent`，双击会静默失效，
而 ⌘K → ⌘⇧R 完全不受影响 —— 这是选"压浮层"而不是"复刻 header"时主动接受的代价。
测试里 5 个 mutation（去掉 null 守卫、去掉 current 守卫、去掉 blur 取消、把选择器放宽到 `crumb`、
去掉 `preventDefault`）都会让套件变红；**默认 82 条测试**。

---

## 13. v0.4.0：标签（2026-10-18）

用户："我想给 session 打标签，可以手动打，也是一个子功能……最多 3 个……点选标签然后过滤搜索。"

### 13.1 存储：为什么是 Config，为什么必须 volatile

| 候选 | 否决理由 |
| --- | --- |
| localStorage / IndexedDB | 桌面端的 web 源是 `http://127.0.0.1:<每次启动的随机端口>`（两次会话分别是 19387 / 52044），**换端口就换 origin**，标签会在重启后消失 |
| 自己写文件 | 客户端没有文件系统；host 写文件要新 host 代码 + 新路径 |
| **插件 Config** | ✅ 已经在用（`takeOver`），profile 的 `cordis.patch.yml` 持久化，客户端有写入口 |

写入口是 `ctx.configForms.get(ROW_ID).set(field, value)`（`dsh-client-ui-settings` 的 `ConfigForm.set` → `remote.settings.mutate(namespace, [{op:'set', path:[field], value}], revision)`）。

**关键在 `.volatile()`**，两件事都靠它：

1. `index.js` 的注释早就写了：只有 volatile 字段会暴露给页面、并被接受写入。
2. `cordis-plugin-loader/lib/index.js:382` 的 `equalExceptVolatile(...)` —— 当配置变更**只**发生在 volatile 字段时，`volatileOnly` 成立，走 `_commitVolatile()` **原地更新**，不 remount。没有这一条，保存一个标签会把面板自己 remount 掉（面板关闭、状态全丢）。

`validateVolatileSchema`（`schemastery/lib/index.mjs:240`）要求 volatile 字段位于**固定对象路径**、且不能嵌套在另一个 volatile 字段里 —— 所以 `tags` / `assignments` 是顶层数组字段，不是 `tags: { ... }` 里的子字段。

### 13.2 数据形状的三个决定

- **id 而不是 label 做身份**：`tagIdFor(label)` 生成 id（保留 CJK 字母，其余折叠成 `-`），重名加 `-2` 后缀。改标签名不会让已有分配成为孤儿。
- **assignments 是扁平数组** `[{sessionId, tags}]`，不是 map：schema 里的 map 需要一个 key domain，而数组不需要。空条目在读和写两头都丢掉。
- **3 个上限在两边都强制**：写入时拒绝并提示（"最多 3 个标签"），读取时截断 —— 手改 YAML 也塞不进第四个。

### 13.3 交互：为什么选择器占右栏，而不是又一个模式

- 面板的左栏是"要动哪一行"，右栏是"这一行长什么样"。打标签需要**同时**看到两件事，所以选择器进右栏，左栏保持原样（甚至可以点另一行来改目标）。
- 选择器是**同一个输入框的第三个职务**：搜索（combobox → 列表）、改名（textbox）、打标签（combobox → 标签表）。`aria-controls` / `aria-activedescendant` 跟着职务换，不假装同一个列表。
- 输入的字**没有任何标签匹配时**，第一行变成「＋ 新建「xxx」」—— 这就是"打新标签"的入口，不需要先开编辑器。
- 点标签 chip **就是筛选**（预览窗格和筛选条是同一个控件）：筛选是「任一命中」，因为标签是用来跨工作区/跨时间归组的，两个标签应该是并集。
- 侧边栏右键菜单那行（`sidebar.workspaces.session.menu.item`，order 460，排在 `session-id` 之后）**不自己实现选择器**，只是"打开面板 + 高亮那行 + 进入标签模式"。一套实现，两个入口。

### 13.4 诚实的边界

- **要重启一次 DSH**。`tags` / `assignments` 是新 host 字段，host 只在启动时读 `index.js`；profile 里的 HMR (`dsh-hmr`) 只做配置热更新，`hmr.root` 是空的，所以模块不热载。没重启前，选择器写「标签需要重启一次 DSH」，**不假装保存成功**。
- **候选编辑器（emoji / 颜色 / 改名）还没做**，本版只能新建（颜色按环取）、分配、移除。Plugin 管理的 configure 页暂时显示原始数据。这是下一个版本。
- 标签是**这个 profile 的**数据，不进 session 日志，所以换机器不同步。
- mutation 验证：去掉筛选 → 1 红；去掉 3 个上限 → 1 红；菜单项不关闭菜单 → 1 红。（`toggleTag` 里那道 `ready` 守卫是第二道防线 —— 外层 `pickTag` 已经拦住，所以单独拆掉它测试仍是绿的，这是"深度防御"而不是"没测到"。）

---

## 14. v0.5.0：让"模式"看得见（2026-10-18）

用户四条反馈里最重的一条：**"按了快捷键后交互有点难理解……我看不到 focus 在哪个 session……为什么还可以上下移动选择 session"**。

### 14.1 为什么会这样（诊断）

三个独立的模糊叠在一起：

1. **唯一的模式信号是输入框的边框色**（`.dsp-inputrow-renaming` 换了个边框颜色）。⌘⇧T 到底生效没有，得靠猜。
2. **屏幕上有两个"高亮"**：会话行是 `aria-selected` 的 hover 底，标签选项是 `data-dsp-tagactive` 的 hover-solid 底。两个都是"淡灰底"，看起来是同一套光标，实际上一个是被改的目标、一个是候选。
3. **鼠标还能换目标**：`onMouseEnter → setManualActiveId` 在模式里照旧生效，于是"要改的是哪一行"会**在你不注意的时候变掉**（键盘没变，鼠标变了）。点击更糟：`onClick` 甚至会打开那个会话。

### 14.2 改法

| 症状 | 改法 |
| --- | --- |
| 不确定在哪个模式 | 输入框下面加一条 **模式条**（`.dsp-modebar`，`role="status"`）：`正在打标签：「标题」 · 1/3` / `正在改名：「标题」`，右侧固定写 `列表是锁的` |
| 看不出 focus 在哪行 | 目标行加 `data-dsp-target` → **左侧 2px 强调条**（business token）；候选高亮保持原来的 hover-solid，两者不再长得一样 |
| 为什么上下键还能换 session | 不能：↑↓ 在标签列表里移动。真正在换的是**鼠标悬浮**，所以模式期间 `onMouseEnter` / `onClick` 直接 return，行上标 `data-dsp-frozen="true"`（`cursor:default`）|
| 打标签时看不到已有的标签 | 选择器顶部列出这个会话现有的标签（**只读 chip**，`span` 而不是 `button`：点标签在别处是"筛选"，在这里不能变成"切换"，否则一个控件两种含义）+ `n/3` |
| 标题后的标签（反馈 3） | 行标题改成 flex：`标题文字(可省略) + 标签(svg/emoji，永不省略)`，标签跟标题，不占右边缘 |
| 侧边栏菜单行没图标（反馈 1） | 改用 `MenuItemButton`（宿主的菜单行组件，自带图标位/间距/hover），图标是自绘的 14px 描边 tag —— 宿主图标表里没有 tag，借 bookmark/star 会表错意 |
| 标签条被挤/遮挡（反馈 2） | `.dsp-filters` 从 `padding:0 16px 7px` + 隐式 `overflow-y` 裁切，改成独立一行 `padding:8px 16px` + 下边框 + `overflow-y:hidden`，且 `flex:none` 不被压扁 |

### 14.3 菜单图标：为什么 require 了一个宿主包

`MenuItemButton` 在 `@deepseek-ai/dsh-client-ui-primitives` 里，是 Module Loader 的**基线 external**（文档明写：Module Loader 包可以 `require` 它，不要另包一份）。它自带图标槽位，是"和其他行一样"的唯一可靠做法。取它是**可选**的：

```js
const MenuItemButton = (() => { try { … } catch { return null } })()
```

拿不到就退回自己的 `.dsp-menuitem`（仍然有图标），不会因为外部表少一项就把整个 bundle 弄挂。测试把这条钉住了：`require` 只能有 `react` 和一个**包在 try 里**的 primitives；并且源码里必须存在 `MenuItemButton === null` 的退路。

### 14.4 仍然没做

- **会话头部标题后面**没有标签。`conversation.session.header.lineage` 的 fallback 只在**没人占用**时渲染（`ui-renderer`：`if (!entry) return fallback`），占用它就会把子 agent 面包屑的标题吃掉 —— 那是复刻宿主 UI，不做。
- 候选标签的 emoji / 颜色编辑器还没做（见 §13.4）。
- 5 个 mutation 验证：去掉模式条 / 悬浮可换目标 / 标签退回右边缘 / 只读 chip 变按钮 —— 都会让套件变红。

---

## 15. v0.6.0：把标签编辑器从搜索框里搬出来（2026-10-18）

用户反馈（原文）：*"我如何给箭头指的这个 session 或者我搜索的 session 加 tag？很难理解。很难操作。我现在上下是锁住的。这个交互真的不行……你要不要查查网络，看看优秀的产品这里怎么做。"*

### 15.1 错在哪（复盘）

上一版把标签做成了**搜索框的第三个职务**：⌘⇧T 之后，同一个输入框从"搜会话"变成"筛标签"，同时为了不让目标乱跑，把会话列表锁了。三个后果，用户全撞上了：

1. 他按 ⌘K 输入 `research` 想找会话 —— 那几个字却成了标签草稿（截图里就是这个状态）。
2. 他想给另一行加标签 —— 列表锁着，动不了。
3. 模式条写着 "Tagging DSH 插件开发 0/3" —— 他要的不是这一行。

**根因不是"锁不锁"，是"一个控件两种含义"。** 锁只是为了让第二种含义不至于改错对象，是补丁，不是设计。

### 15.2 查到的做法（都指向同一件事）

- Notion 的属性弹层、Linear 的 label picker、Finder 的 Tags、Gmail 的标签菜单：**选择器附着在被选中的那一项上**，有自己的输入框、自己的列表、自己的关闭；底下那一项保持选中且可见，选择器的标题写着它改的是谁。
- shadcn 的 command-popover 例子同样把 picker 做成**从触发器展开的浮层**，而不是复用页面上的搜索框。
- 共同点：**页面级搜索框的语义不变**。

### 15.3 新模型

| 之前 | 现在 |
| --- | --- |
| ⌘⇧T → 搜索框变成标签筛选 | ⌘⇧T → **右栏里**（会话详情）打开编辑器，**搜索框照旧搜会话** |
| 列表锁死，鼠标划过也不动 | 列表永远活的：划过照常换高亮 |
| 目标可能被锁在别人身上 | 编辑器属于它打开时那一行：**高亮一换就关掉**（不会悄悄改到别的会话） |
| 模式条解释"现在在干什么" | 不需要解释：两个输入框在两个地方，各自有 placeholder 和 esc |

右栏里那一条**常驻**的标签行（chips + `＋ 标签` + `n/3`）是关键：不打标签的时候它也告诉你会话上有什么，点 `＋` 就是鼠标用户的入口；`⌘⇧T` 只是同一个按钮的键盘路径。

### 15.4 仍然成立的两条

- 点标签 = 筛选（chips 在所有地方同一个含义）。
- 候选列表里"新建"永远排第一（当草稿不匹配任何已有标签时）。

### 15.5 诚实的边界

- 编辑器打开时**移动高亮会关掉它**（包括鼠标划过）。这是有意的：宁可少一步方便，也不要"改错会话"。
- 窄窗口（< 700px）右栏隐藏，`⌘⇧T` 就没有编辑器可开 —— 这是已知缺口，还没有兜底。
- mutation：去掉"高亮变化即关闭" / 去掉 ready 守卫，各 1 红。

---

## 16. v0.7.0：在一个很长的列表里不迷路（2026-10-18）

用户："这个 session list 可能很长，滚动的时候人会迷失……有没有 indicator……有时候记不住 session 但记得工作区，有时候都记不住，但是往下翻可以翻到。浮窗可以再做大一点。"

### 16.1 三条记忆轴，之前只有两条做顺了

| 你记得的 | 之前 | 现在 |
| --- | --- | --- |
| 标题 | ✅ 搜索 | 不变 |
| 工作区 | ⚠️ 只是行里一行小字，要"已知名字"才能搜到 | ✅ 第四个视图「工作区」 |
| 都没有 | ⚠️ 能翻，但滚两屏就没有地标了 | ✅ 吸顶分组 + 位置 + 跳转 |

### 16.2 迷失不是"长"的问题

- **地标会滚走**：分组标题跟着内容滚上去，第二屏开始只剩同构的行 → `.dsp-group{position:sticky;top:0}`（背景必须不透明，否则行会从标题后面穿过去）。
- **没有位置感**：`80 个会话` 回答不了"我是不是翻丢了"。页脚改成 `37 / 340`。
- **跳不动**：`Home/End` 早就有，但要光标先到两端才生效；长列表需要无条件的 <kbd>⌘↑</kbd>/<kbd>⌘↓</kbd>。翻页用 <kbd>PgUp</kbd>/<kbd>PgDn</kbd>，**夹住不循环** —— 翻页回头读起来像 bug。

### 16.3 为什么不做"真·翻页"

翻页把一个连续列表切成一叠卡片，页与页之间丢上下文；而它想解决的"地标丢失"用吸顶标题 + 跳转解决得更彻底，还完全不改变排序的可预期性。同理拒绝"最近浏览"排序：宿主只给 `updatedAt = 最后一次你发言`，没有"最后查看"，造一个就是骗人。

### 16.4 工作区视图

`VIEWS = ['recents','workspaces','pinned','archived']`，模型里一个分支：按 `row.workspace`（工作区标题，退化到目录名）分组，**组的顺序 = 组内最好那行的顺序**（因为 `decorated` 已经排好），所以最近碰过的工作区在最上面；组内保持原来的排序（需要你 > 活跃 > 时间）。

坑：`if (view !== 'recents')` 这个抽屉分支会把 `workspaces` 也吃进去（当时它只认识 pinned/archived），必须先改成精确匹配 —— 这个 bug 被测试抓住了一次。

### 16.5 尺寸

`920 → 1180px`、`78vh → 88vh`、顶距 `14vh → 8vh`、左右 `60/40`、右栏内边距加大。预览窗格因此能装下更多正文 —— 加大浮窗的收益不只在线列表。

### 16.6 数字

107 条测试（原 101）。5 个 mutation：去掉跳转键 / 翻页改成循环 / 日期永远相对 / 工作区视图失效 / 去掉 sticky —— 各红 1 条。

---

## 17. v0.8.0：删除标签（2026-10-18）

用户："我如何删除一个标签？删除前提醒一次，移除那些被打了该标签的 session 即可。"

### 17.1 这是"改词表"，不是"改某个会话"

所以入口放在**标签编辑器**（词表所在处），不是放在会话行或筛选条上：删除一个标签是全局操作，挂在它下面的所有会话都会失去它。放在行上会让人以为只影响这一条。

### 17.2 为什么提醒里要说"几个会话"

`删除「dev」？` 不够——用户真正在权衡的是"我会丢掉多少条线索"。所以提示按实际数量分三档：

- `删除「dev」？3 个会话会失去它。`
- `删除「dev」？挂在 1 个会话上。`
- `删除「dev」？现在没有会话挂着它。`（"0 个会话"读起来像 bug）

### 17.3 一次写入，不是两次

`tags` 和 `assignments` 必须一起改：中间态会让分配指向一个已经不存在的标签（幽灵标签），而 `form.set` 是两条独立的 revision。所以用了 `ConfigForm.mutate([...ops])` —— 一次 revision、一次校验、一次推送。

### 17.4 交互

| 动作 | 触发 |
| --- | --- |
| 开始删除（**只是问**） | 行尾的 `×`，或 <kbd>⌘⌫</kbd> / <kbd>⌃⌫</kbd>（列表里"删掉这一行"的通行手势；单行输入框里 ⌘⌫ 原本的"删到行首"没有意义） |
| 真的删 | <kbd>⏎</kbd> 或点「删除」 |
| 算了 | <kbd>esc</kbd>（退出**确认**，不是退出编辑器）、点「保留」、或点列表里任何一行 |

确认条放在列表**下面**而不是塞进行里：行要保住宽度和"点它就是切换"的含义。

### 17.5 两个附带决定

- 如果当前正按这个标签筛选，**筛选一起清掉** —— 否则会得到一个空列表，而且屏幕上没有任何东西解释为什么空。
- **撤销**：提示条里的 Undo 把词条和那些分配一起放回去。这和归档/改名的做法一致 —— 破坏性操作在这个插件里都留一个后门。

### 17.6 数字

113 条测试（原 107）。4 个 mutation：不问就删 / 分配保留死 id / 拆成两次写入 / esc 直接关编辑器 —— 分别红 5、1、1、1 条。

## 18. v0.8.1：兼容性是核过的，不是抄的（2026-10-18）

上一版的 README 写着"实测于 DSH 0.2.0-rc.2"，而桌面端在 10-17 已经升到 **0.2.1-rc.2**。这句话于是变成了一个没人维护的断言 —— 它不会报错，但它在骗人。

这一版只做核对与登记，没有功能改动：

- **端到端仍然成立**：0.8.0 的改名、标签、长列表就是在这台机器的 0.2.1-rc.2 上验的，所以中文那句"实测范围"直接改成当前版本。
- **锚点还在**：双击标题依赖的 `crumbCurrent` 类名后缀，在 0.2.1-rc.2 的 `dsh-client-ui-conversation` 里仍然是 `<hash>_crumbCurrent`。这条写进了 Compatibility 表，因为它是唯一依赖宿主 DOM 的地方。
- **其余契约逐个复核**：`shell.overlay`、`sidebar.workspaces.session.menu.item`（本插件的 `session-palette.tags` 行仍以 order 460 挂在里面）、`sessions.using`、`registerFixed`、`turnOutline` —— 都在。核对方法是 Cordis Inspect 的只读查询，不是读代码猜。

顺带补了 `repository` / `homepage` / `bugs` 三个字段：包里一直缺，GitHub 页面上也没有仓库链接。

没有新增测试（114 → 113 也没变，功能没动）。
