/**
 * opencode-btw — server part.
 *
 * Native OpenCode V2 rewrite of the pi extension `pi-btw`. The original
 * `/btw` asked a side question against the current conversation, streamed the
 * answer into a TUI overlay and never appended it to the session (so it spent
 * no main-context tokens).
 *
 * In OpenCode V2 the work is split in two parts:
 *   - this server part owns the `/btw` command, question history, and the
 *     transient model call (`ctx.session.generate`), which reuses the session's
 *     context/model/system prompt and does not write to session history;
 *   - `src/tui.tsx` owns the overlay, dialogs and keybindings.
 * They communicate over the RPC contract in `src/rpc.ts`.
 */
import { Plugin } from "@opencode/plugin"
import { Btw } from "./rpc"

/** Default number of remembered questions; override with plugin option `historyLimit`. */
const DEFAULT_HISTORY_LIMIT = 20

const HISTORY_KEY = "btw/history"

/**
 * The side-question reminder. `ctx.session.generate` already supplies the
 * session's own system prompt and conversation prefix, so this is appended as
 * the transient prompt text rather than injected into the real conversation.
 */
const SIDE_QUESTION_PROMPT = `<system-reminder>This is a side question from the user. Answer it directly, in a single response.

CONTEXT:
- You are a short-lived agent spawned to answer exactly one question
- The main agent is NOT interrupted and is NOT waiting for you; it keeps working independently
- You share the conversation context above, but you are a separate instance
- Do not talk about being interrupted or about "what you were doing before"

HARD CONSTRAINTS:
- You have NO tools. You cannot read files, run commands, or take any action
- There is no follow-up turn, so never say "let me check", "I'll look", "one moment"
- Answer only from the conversation context you already have
- If you do not know, say so plainly instead of offering to find out
- Keep it short: a few sentences unless the question genuinely needs more</system-reminder>`

function historyLimit(ctx: { options: unknown }): number {
  const configured = (ctx.options as { historyLimit?: unknown } | undefined)?.historyLimit
  return typeof configured === "number" && Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : DEFAULT_HISTORY_LIMIT
}

async function loadHistory(ctx: { storage: { get(key: string): Promise<unknown> } }): Promise<string[]> {
  try {
    const value = await ctx.storage.get(HISTORY_KEY)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, DEFAULT_HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

async function remember(
  ctx: { storage: { get(key: string): Promise<unknown>; set(key: string, value: string[]): Promise<void> } },
  question: string,
): Promise<void> {
  const limit = historyLimit(ctx)
  if (limit === 0) return
  const previous = await loadHistory(ctx)
  const next = [question, ...previous.filter((item) => item !== question)].slice(0, limit)
  try {
    await ctx.storage.set(HISTORY_KEY, next)
  } catch {
    // History is a convenience; never fail a side question because of it.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

export default Plugin.define({
  id: "opencode-btw",
  async setup(ctx) {
    const rpc = await ctx.rpc.register(Btw, {
      ask: async (input, context) => {
        const { sessionID, question } = input as { sessionID: string; question: string }
        const trimmed = question.trim()

        // Remember at ask time, even if generation later fails.
        if (trimmed) await remember(ctx, trimmed)

        if (!trimmed) return { text: "", tokens: 0, error: "Empty question." }

        try {
          // Transient generation: reuses the session's context, model and
          // system prompt (so the cached prefix is reused) but is NOT added to
          // session history, invokes no tools, and spawns no new session.
          const result = await ctx.session.generate(
            { sessionID, prompt: `${SIDE_QUESTION_PROMPT}\n\n${trimmed}` },
            { signal: context.signal },
          )
          return {
            text: result.text,
            tokens: typeof result.tokens === "number" ? result.tokens : 0,
            error: "",
          }
        } catch (error) {
          return { text: "", tokens: 0, error: errorMessage(error) }
        }
      },

      history: async () => ({ questions: await loadHistory(ctx) }),
    })

    // The pi original used pi.registerCommand. Here the command still lives on
    // the server so it reliably receives the current sessionID, but it only
    // hands off to the TUI overlay instead of mutating the conversation.
    const command = await ctx.command.transform((editor) => {
      editor.add({
        name: "btw",
        description: "Ask a quick side question without interrupting the main conversation",
        execute: async ({ sessionID, prompt }) => {
          await rpc.events.emit("invoke", {
            sessionID,
            question: (prompt.text ?? "").trim(),
          })
        },
      })
    })

    return async () => {
      await command.dispose()
      await rpc.dispose()
    }
  },
})
