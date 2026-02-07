import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

type ServerEvent =
  | { type: "session"; session_id: string }
  | { type: "text_delta"; content: string }
  | { type: "tool_start"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "done"; cost_usd?: number }
  | { type: "error"; message: string };

const sessions = new Map<
  string,
  { messages: MessageParam[]; created_at: number }
>();

const ALLOWED_MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

const DEFAULT_MODEL: AllowedModel = "claude-sonnet-4-5-20250929";

const MODEL_COSTS: Record<AllowedModel, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-6": { input: 15, output: 75 },
};

const MAX_TOKENS = 4096;

export const config = {
  runtime: "edge",
  maxDuration: 60,
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: { message?: string; session_id?: string; system_prompt?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.message || typeof body.message !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing required field: message" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const sessionId = body.session_id ?? crypto.randomUUID();
  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], created_at: Date.now() };
    sessions.set(sessionId, session);
  }

  session.messages.push({ role: "user", content: body.message });

  const resolvedModel: AllowedModel =
    body.model && (ALLOWED_MODELS as readonly string[]).includes(body.model)
      ? (body.model as AllowedModel)
      : DEFAULT_MODEL;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ServerEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "session", session_id: sessionId });

      try {
        const streamParams: Parameters<typeof client.messages.stream>[0] = {
          model: resolvedModel,
          max_tokens: MAX_TOKENS,
          messages: session!.messages,
        };

        if (body.system_prompt) {
          streamParams.system = body.system_prompt;
        }

        const messageStream = client.messages.stream(streamParams);

        let assistantText = "";

        for await (const event of messageStream) {
          switch (event.type) {
            case "content_block_start": {
              if (event.content_block.type === "tool_use") {
                send({
                  type: "tool_start",
                  tool: event.content_block.name,
                  input: "",
                });
              }
              break;
            }
            case "content_block_delta": {
              if (event.delta.type === "text_delta") {
                assistantText += event.delta.text;
                send({ type: "text_delta", content: event.delta.text });
              } else if (event.delta.type === "input_json_delta") {
                send({
                  type: "tool_start",
                  tool: "",
                  input: event.delta.partial_json,
                });
              }
              break;
            }
          }
        }

        const finalMessage = await messageStream.finalMessage();

        session!.messages.push({
          role: "assistant",
          content: finalMessage.content,
        });

        const inputTokens = finalMessage.usage.input_tokens;
        const outputTokens = finalMessage.usage.output_tokens;
        const costs = MODEL_COSTS[resolvedModel];
        const costUsd =
          (inputTokens * costs.input) / 1_000_000 + (outputTokens * costs.output) / 1_000_000;

        send({
          type: "done",
          cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
