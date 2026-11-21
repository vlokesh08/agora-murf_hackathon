import { env } from "../config/env";

export interface StepOutcome {
  title: string;
  status: string;
  output?: Record<string, unknown>;
}

export interface GenerateResponseInput {
  requestText: string;
  tone: string;
  goal: string;
  steps: StepOutcome[];
  error?: string;
}

// Provider-agnostic seam for the model that understands intent and writes
// the final reply. `createLLMProvider()` picks Groq when GROQ_API_KEY is
// set, otherwise falls back to a deterministic mock so the app still runs
// with zero API keys.
export interface LLMProvider {
  name: string;
  generateResponse(input: GenerateResponseInput): Promise<string>;
}

class MockLLMProvider implements LLMProvider {
  name = "mock";

  async generateResponse({ requestText, tone, goal, steps, error }: GenerateResponseInput) {
    const label = tone.split(".")[0];
    if (error) return `Hmm, I ran into a problem: ${error}`;
    if (steps.length === 0) {
      return `(${label}) Got it: "${requestText}". Here's what I found and did.`;
    }
    const anyCancelled = steps.some((s) => s.status === "cancelled" || s.status === "skipped");
    const anyFailed = steps.some((s) => s.status === "failed");
    const anySucceeded = steps.some((s) => s.status === "completed");
    const doneSteps = steps.filter((s) => s.status === "completed").map((s) => s.title);
    const highlight = doneSteps.length > 0 ? ` (${doneSteps.join(", ")})` : "";
    if (anyFailed && !anySucceeded) {
      return `Couldn't pull this one off — "${goal}" hit an error every step of the way.`;
    }
    if (anyFailed) {
      return `Mostly good news on "${goal}"${highlight} — one source hit a snag, so a bit may be missing.`;
    }
    return anyCancelled
      ? `Here's "${goal}"${highlight} — skipped whatever you didn't approve.`
      : `Done — "${goal}"${highlight}, double-checked and solid.`;
  }
}

class GroqLLMProvider implements LLMProvider {
  name = "groq";

  constructor(
    private apiKey: string,
    private model: string = env.groqModel
  ) {}

  async generateResponse(input: GenerateResponseInput): Promise<string> {
    const system = [
      "You are a personal automation assistant replying to the user after a run.",
      `Tone: ${input.tone}`,
      "You have a personality, not just competence: react to what you actually found (surprise, reassurance, light opinion) instead of reading out a flat status line — e.g. prefer \"Heads up, Rohan's doc on that thread is still unread\" over \"1 email found: unread\".",
      "Write ONE short reply (2-4 sentences max), like a sharp assistant talking to someone they know, not a status report.",
      "Never reveal internal reasoning, tool names, or step IDs — describe outcomes in plain language.",
      "The `steps` array in the user message is the ONLY source of truth for what actually happened.",
      "Base every factual claim strictly on that array — never invent, assume, or guess at actions, approvals, connections, or system state that aren't explicitly listed there.",
      "If `steps` is an empty array, no tool or integration ran at all for this request — do not claim anything did or didn't happen, was or wasn't approved/connected, etc. Just respond to the user's message directly as a normal conversational reply, or ask a clarifying question if the request is ambiguous.",
      "Only claim something succeeded if its status is 'completed'.",
      "If a step was 'cancelled' or 'skipped', say the user chose not to approve it — don't apologize excessively.",
      "If a step was 'failed', briefly say that specific source hit an error (no stack traces or technical detail) — don't pretend it returned empty or succeeded.",
      "Several steps may each pull from a different source (calendar, email, GitHub, ...) for one request — when that happens, segregate your reply by source: cover each one in its own sentence or short clause (e.g. calendar first, then email, then GitHub) so the user can tell which finding came from where, rather than blending everything into one generic sentence. Still merge what succeeded even if another source in the same batch failed or returned nothing — just skip that source instead of apologizing for it. For a request with only one source, answer normally in one flowing reply without labeling it.",
    ].join(" ");

    const user = JSON.stringify({
      userRequest: input.requestText,
      goal: input.goal,
      error: input.error,
      steps: input.steps.map((s) => ({ what: s.title, status: s.status, result: s.output })),
    });

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: 300,
          temperature: 0.4,
          reasoning_effort: "low",
        }),
      });

      if (!res.ok) {
        console.error("Groq request failed", res.status, await res.text().catch(() => ""));
        return new MockLLMProvider().generateResponse(input);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      return content || (await new MockLLMProvider().generateResponse(input));
    } catch (err) {
      console.error("Groq request error", err);
      return new MockLLMProvider().generateResponse(input);
    }
  }
}

export function createLLMProvider(): LLMProvider {
  if (env.groqApiKey) return new GroqLLMProvider(env.groqApiKey);
  return new MockLLMProvider();
}
