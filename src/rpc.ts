/**
 * Typed RPC contract shared by the server part (`index.ts`) and the TUI part
 * (`tui.tsx`) of the plugin.
 *
 * - `ask` runs the transient side-question generation in the server, where the
 *   session context lives, and returns the answer without adding it to history.
 * - `history` returns the persisted recent questions.
 * - `invoke` is emitted by the server-side `/btw` command so the TUI can open
 *   its overlay (a server plugin cannot open a terminal overlay by itself).
 */
import { Rpc } from "@opencode/plugin/rpc"

export const Btw = Rpc.define({
  id: "opencode-btw",
  methods: {
    ask: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          question: { type: "string" },
        },
        required: ["sessionID", "question"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          tokens: { type: "number" },
          error: { type: "string" },
        },
        required: ["text", "tokens", "error"],
        additionalProperties: false,
      },
    },
    history: {
      output: {
        type: "object",
        properties: {
          questions: { type: "array", items: { type: "string" } },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
  },
  events: {
    invoke: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          question: { type: "string" },
        },
        required: ["sessionID", "question"],
        additionalProperties: false,
      },
    },
  },
})
