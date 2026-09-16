import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hasPage, ingest, listPages, snapshot, type PageMsg, type ViewMsg } from "./state.js";
import { registerTools } from "./tools.js";

const PORT = Number(process.env.READING_BUDDY_PORT ?? 8737);
const HOST = "127.0.0.1";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

// Stateless MCP: a fresh server+transport per request. Both Claude Code and Codex can
// connect concurrently without session bookkeeping.
async function handleMcp(req: IncomingMessage, res: ServerResponse, rawBody: string | undefined) {
  const server = new McpServer({ name: "reading-buddy", version: "0.1.0" });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  const parsed = rawBody ? JSON.parse(rawBody) : undefined;
  await transport.handleRequest(req, res, parsed);
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version",
      });
      return res.end();
    }

    if (url.pathname === "/state" && req.method === "POST") {
      const msg = JSON.parse(await readBody(req)) as PageMsg | ViewMsg;
      if (msg.type !== "page" && msg.type !== "view") return json(res, 400, { error: "type must be page|view" });
      ingest(msg);
      console.log(`${new Date().toISOString()} ${msg.type} ${msg.url}${msg.type === "view" ? ` visible=${JSON.stringify(msg.visible)} sel=${msg.selection ? "yes" : "no"}` : ` blocks=${msg.blocks.length}`}`);
      // After a hub restart we may get a view for a page we never received; ask the
      // extension to resend the page blocks.
      const needPage = msg.type === "view" && !hasPage(msg.url);
      return json(res, 200, { ok: true, needPage });
    }

    if (url.pathname === "/state" && req.method === "GET") {
      const { page, view } = snapshot(url.searchParams.get("book") ?? undefined);
      return json(res, 200, {
        view,
        page: page && { url: page.url, title: page.title, blockCount: page.blocks.length },
        pages: listPages(),
      });
    }

    if (url.pathname === "/mcp") {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      return await handleMcp(req, res, body);
    }

    if (url.pathname === "/") return json(res, 200, { name: "reading-buddy hub", endpoints: ["/state", "/mcp"] });
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: String(err) });
    else res.end();
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`reading-buddy hub listening on http://${HOST}:${PORT}  (POST /state, MCP at /mcp)`);
});
