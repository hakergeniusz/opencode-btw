# opencode-btw

`/btw` — ask a quick side question without interrupting the main conversation or spending main-context tokens.

A native **OpenCode V2** plugin. It is a rewrite of the pi extension
[`pi-btw`](https://github.com/hakergeniusz/pi-btw), which was itself an
independent implementation of Claude Code's `src/commands/btw` +
`src/utils/sideQuestion.ts`.

## What it does

- Registers a `/btw <question>` slash command. The main agent is neither
  interrupted nor queued; nothing is added to the session.
- Generates the answer as a **transient** call on the current session
  (`ctx.session.generate`), reusing the session's model, system prompt and
  conversation context so the provider's cached prefix is reused. The result is
  **never appended to session history**, so it costs no main-context tokens and
  invokes no tools.
- Shows the answer in a TUI dialog overlay. Esc / Enter / Space dismisses it;
  Up / Down scrolls long answers.
- Remembers recent questions (durable plugin storage, newest-first, deduplicated,
  capped). With no arguments, a prompt dialog asks for the question and falls
  back to selecting one from the recent list.

## Parts and API mapping

The package has three exports:

| Export | File | Role |
|---|---|---|
| `.` | `src/index.ts` | Server part: `/btw` command, history, transient generation |
| `./tui` | `src/tui.tsx` | TUI part: overlay, dialogs, toasts, keybindings |
| `./rpc` | `src/rpc.ts` | Typed RPC contract shared by both parts |

| pi concept | OpenCode V2 equivalent used here |
|---|---|
| `pi.registerCommand` | `ctx.command.transform((editor) => editor.add(...))` |
| command `execute(args, ctx)` | `execute: async ({ sessionID, prompt }) => ...`, emitting an RPC event |
| `ctx.modelRegistry.streamSimple` + `buildMessages` + `ctx.getSystemPrompt()` | `ctx.session.generate({ sessionID, prompt })` — reuses the session's system prompt/context and does not touch history |
| `ctx.sessionManager.buildSessionProjection()` | handled internally by OpenCode's session context |
| `ctx.getSystemPrompt()` | supplied automatically by `session.generate` |
| `activeToolSchemas(pi)` | not exposed to plugins (see gaps) |
| `ctx.thinkingLevel` / reasoning passthrough | inherited from the session model (see gaps) |
| `ctx.ui.custom(...)` overlay | `context.ui.dialog.show(...)` with a Solid/OpenTUI dialog |
| `pi.on(...)` / UI completion | `context.keymap.layer(...)` and `context.ui.dialog.prompt/select` |
| `getAgentDir()` + `fs.readFileSync/writeFileSync` history | `ctx.storage.get/set` in the server part |
| tool-call attempt reporting | not applicable: `session.generate` does not invoke tools |

The command is registered on the **server** so it reliably receives the current
`sessionID`, then hands off to the TUI over an RPC `invoke` event. The TUI calls
the server's `ask` RPC method to do the generation. This split is required
because a server plugin cannot open a terminal overlay and a TUI command does
not receive the session ID.

## Install / load

Add the package to `plugins` in `opencode.json(c)` (or to `cli.json` if you only
want the TUI part). Loading the package loads all three parts:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-btw",
      "options": {
        "historyLimit": 20
      }
    }
  ]
}
```

For a local checkout during development:

```jsonc
{
  "plugins": ["./plugins/opencode-btw"]
}
```

Options are read from `ctx.options` in the server part:

- `historyLimit` (number, default `20`) — how many recent questions to remember.

## Known gaps / differences from the pi original

- **No token-by-token streaming.** The pi original used a raw provider stream
  and rendered deltas as they arrived. The V2 plugin API has no streaming
  generation primitive, so the overlay shows an "Answering…" indicator and then
  the complete answer. Dismissing early hides the overlay and discards a late
  result; the underlying generation is not client-cancellable.
- **No prompt-cache tool declarations.** The original replayed the active tool
  schemas so the cached prefix matched exactly. Plugins cannot read raw tool
  schemas for a generation call; `session.generate` reuses the session context,
  which preserves most of the cache benefit.
- **No explicit token cap or reasoning-level passthrough.** The original set
  `maxTokens: 4096` and forwarded the session's thinking level. `session.generate`
  inherits the session's defaults; overriding these per-call is not exposed to
  plugins.
- **No slash-command argument completions from history.** pi's
  `getArgumentCompletions` has no direct V2 equivalent. Recent questions are
  instead offered through the selection dialog when `/btw` is run without
  arguments.
- **Ctrl+P / Ctrl+N scrolling is dropped.** OpenCode reserves these for dialog
  navigation. Up / Down scroll instead; Page Up / Page Down are also omitted.
- **Headless (`opencode run`) invocation is a no-op.** The overlay lives in the
  TUI, so `/btw` only has visible behavior in the terminal UI. The original's
  stdout fallback cannot be reproduced from a server plugin.

## Tests

Not ported. The original tests drove a fake pi `ExtensionAPI`/`ExtensionCommandContext`
and pi-TUI components; porting them would require pi runtime types that a native
OpenCode plugin must not depend on.

MIT licensed.
