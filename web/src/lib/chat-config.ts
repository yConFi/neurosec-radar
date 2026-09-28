// Chat settings shared by the server route (owner, app key) and the browser (visitor, own key).

// Same model as the collector (CLAUDE.md: Claude Haiku 4.5). No batch here: the answer is live.
export const CHAT_MODEL = "claude-haiku-4-5"
export const MAX_ANSWER_TOKENS = 1500
export const MAX_QUESTION_CHARS = 2000
export const HISTORY_MESSAGES = 20 // last N turns sent back to the model
