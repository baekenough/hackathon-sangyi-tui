import Anthropic from "@anthropic-ai/sdk";

export const config = {
  runtime: "edge",
  maxDuration: 15,
};

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: {
    message: string;
    agents: Array<{ id: string; name: string; description: string }>;
    skills: Array<{ id: string; name: string; description: string }>;
    guides: Array<{ id: string; name: string; description: string }>;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ agents: [], skills: [], guides: [], reasoning: "Invalid request" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const agentList = body.agents?.map(a => `- ${a.id}: ${a.name} — ${a.description}`).join("\n") || "(none)";
  const skillList = body.skills?.map(s => `- ${s.id}: ${s.name} — ${s.description}`).join("\n") || "(none)";
  const guideList = body.guides?.map(g => `- ${g.id}: ${g.name} — ${g.description}`).join("\n") || "(none)";

  const systemPrompt = `You are a workspace configuration assistant. Given a user's message, recommend which agents, skills, and guides to enable.

Available agents:
${agentList}

Available skills:
${skillList}

Available guides:
${guideList}

Rules:
- Select 1-3 most relevant agents (at least 1)
- Select 0-2 most relevant skills
- Select 0-1 most relevant guides
- Be selective — only enable what's clearly useful
- If general chat, enable the most general-purpose agent

Respond with ONLY valid JSON:
{"agents":["id1"],"skills":["id1"],"guides":["id1"],"reasoning":"One sentence"}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: body.message }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ agents: [], skills: [], guides: [], reasoning: "Could not parse" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const result = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({
      agents: result.agents || [],
      skills: result.skills || [],
      guides: result.guides || [],
      reasoning: result.reasoning || "",
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      agents: [],
      skills: [],
      guides: [],
      reasoning: "Auto-config unavailable",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
