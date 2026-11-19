/** @jsxImportSource @opentui/solid */
/**
 * opencode-btw — TUI part.
 *
 * The defining behavior of the pi original was its streaming overlay: the
 * answer is shown to the user but never appended to the session. A server
 * plugin cannot open a terminal overlay, so the `/btw` command emits an RPC
 * event (see src/rpc.ts) and this part renders the overlay, asks the user for a
 * question when none was given, and calls the server's `ask` method.
 */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { Btw } from "./rpc"

/** Lines shown at once in the answer window (mirrors the original overlay). */
const MAX_LINES = 18
/** Lines moved by Up/Down. */
const SCROLL_LINES = 3

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

export default Plugin.define({
  id: "opencode-btw.tui",
  setup(context) {
    const btw = context.client.rpc(Btw)

    const themeText = context.theme.text as unknown as Record<string, string>
    const baseColor = themeText.base ?? "#ffffff"
    const mutedColor = themeText.muted ?? baseColor
    const accentColor =
      (context.theme as unknown as { accent?: Record<string, string> }).accent?.base ?? baseColor

    const [active, setActive] = createSignal(false)
    const [question, setQuestion] = createSignal("")
    const [answer, setAnswer] = createSignal("")
    const [error, setError] = createSignal("")
    const [tokens, setTokens] = createSignal(0)
    const [done, setDone] = createSignal(false)
    const [scroll, setScroll] = createSignal(0)

    /** Set while an overlay is open; the dismiss command calls it. */
    let dismiss = () => {}

    function bodyLines(): string[] {
      if (error()) return error().split("\n")
      if (answer().trim()) return answer().replace(/\s+$/, "").split("\n")
      if (done()) return ["No response received."]
      return ["Answering…"]
    }

    function visibleText(): string {
      const lines = bodyLines()
      const maxScroll = Math.max(0, lines.length - MAX_LINES)
      const offset = Math.min(Math.max(0, scroll()), maxScroll)
      const start = Math.max(0, lines.length - MAX_LINES - offset)
      return lines.slice(start, start + MAX_LINES).join("\n")
    }

    function hintText(): string {
      const base = done() ? "Enter or Esc to dismiss" : "Esc to dismiss"
      const scrolling = bodyLines().length > MAX_LINES ? " · Up/Down to scroll" : ""
      const count = tokens() > 0 ? ` · ${tokens().toLocaleString()} tokens` : ""
      return `${base}${scrolling}${count}`
    }

    function openOverlay(questionText: string): Promise<void> {
      setQuestion(questionText)
      setAnswer("")
      setError("")
      setTokens(0)
      setDone(false)
      setScroll(0)

      let resolveClosed!: () => void
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve
      })

      const close = () => {
        if (!active()) return
        setActive(false)
        context.ui.dialog.clear()
        resolveClosed()
      }
      dismiss = close
      setActive(true)

      context.ui.dialog.set({ size: "large", centered: true })
      context.ui.dialog.show(
        () => (
          <box>
            <text fg={accentColor}>/btw {question()}</text>
            <text> </text>
            <text fg={baseColor}>{visibleText()}</text>
            <text> </text>
            <text fg={mutedColor}>{hintText()}</text>
          </box>
        ),
        () => {
          if (active()) {
            setActive(false)
            resolveClosed()
          }
        },
      )

      return closed
    }

    async function resolveQuestion(raw: string): Promise<string> {
      const fromArgs = raw.trim()
      if (fromArgs) return fromArgs

      const typed = await context.ui.dialog.prompt({
        title: "Side question",
        placeholder: "ask anything about the current conversation",
      })
      const trimmed = typed?.trim()
      if (trimmed) return trimmed

      const history = (await btw.history()) as { questions: string[] }
      if (history.questions.length > 0) {
        const picked = await context.ui.dialog.select({
          title: "Recent side questions",
          options: history.questions.map((item) => ({ title: item, value: item })),
        })
        return picked ?? ""
      }
      return ""
    }

    // Keybindings for the overlay. Ctrl+P/Ctrl+N are reserved by OpenCode's
    // dialogs, so scrolling uses Up/Down (page keys are documented as a gap).
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-btw.dismiss.escape",
          title: "Dismiss side answer",
          bind: "escape",
          enabled: active,
          run: () => dismiss(),
        },
        {
          id: "opencode-btw.dismiss.enter",
          title: "Dismiss side answer",
          bind: "enter",
          enabled: active,
          run: () => dismiss(),
        },
        {
          id: "opencode-btw.dismiss.space",
          title: "Dismiss side answer",
          bind: "space",
          enabled: active,
          run: () => dismiss(),
        },
        {
          id: "opencode-btw.scroll.up",
          title: "Scroll answer up",
          bind: "up",
          enabled: active,
          run: () => setScroll((value) => value + SCROLL_LINES),
        },
        {
          id: "opencode-btw.scroll.down",
          title: "Scroll answer down",
          bind: "down",
          enabled: active,
          run: () => setScroll((value) => Math.max(0, value - SCROLL_LINES)),
        },
      ],
      bindings: [
        "opencode-btw.dismiss.escape",
        "opencode-btw.dismiss.enter",
        "opencode-btw.dismiss.space",
        "opencode-btw.scroll.up",
        "opencode-btw.scroll.down",
      ],
    }))

    const unsubscribe = btw.events.on("invoke", async (event) => {
      const data = event.data as { sessionID: string; question: string }
      const questionText = await resolveQuestion(data.question)
      if (!questionText) {
        context.ui.toast.show({ message: "Usage: /btw <your question>", variant: "warning" })
        return
      }

      const closed = openOverlay(questionText)
      try {
        const result = (await btw.ask({ sessionID: data.sessionID, question: questionText })) as {
          text: string
          tokens: number
          error: string
        }
        if (active()) {
          if (result.error) setError(result.error)
          else setAnswer(result.text)
          setTokens(result.tokens)
          setDone(true)
        }
      } catch (error) {
        if (active()) {
          setError(errorMessage(error))
          setDone(true)
        }
      }
      await closed
    })

    return () => unsubscribe()
  },
})
