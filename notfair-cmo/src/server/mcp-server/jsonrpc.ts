import { describeTool, type ToolDefinition } from "./tools";

/**
 * JSON-RPC 2.0 dispatcher for notfair-cmo's outbound MCP servers.
 *
 * Each MCP server endpoint (e.g. /api/mcp/orchestration, /api/mcp/browser)
 * passes its own tool registry to `handleJsonRpc`. Splitting the surface
 * into multiple servers keeps related tools grouped, lets users
 * enable/disable per-MCP, and makes "what is this MCP for?" obvious from
 * the server name alone.
 *
 * MCP methods we implement:
 *   - initialize: handshake; reports protocol version + server info
 *   - tools/list: returns the available tool defs (name + JSON-schema)
 *   - tools/call: executes a named tool with arguments
 *
 * Notifications (no id) we no-op so older clients that send
 * `notifications/initialized` don't error.
 *
 * Auth is upstream of this dispatcher (the route checks the Bearer first);
 * callers reaching here are already authenticated.
 */

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };

const PROTOCOL_VERSION = "2025-06-18";

export interface McpServerInfo {
  /** Server name reported in `initialize`. Should match the MCP registration key (e.g. "notfair-orchestration"). */
  name: string;
  /** Server version string. Bump when wire-visible behavior changes. */
  version: string;
  /** Tool registry for this server. */
  tools: ReadonlyArray<ToolDefinition>;
}

export async function handleJsonRpc(
  req: JsonRpcRequest,
  server: McpServerInfo,
): Promise<JsonRpcResponse | null> {
  // Notifications (no id): handle the side-effecting ones but never reply.
  if (req.id === undefined || req.id === null) {
    return null;
  }
  const id = req.id;

  try {
    switch (req.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: server.name, version: server.version },
          capabilities: { tools: {} },
        });
      case "tools/list":
        return ok(id, { tools: server.tools.map(describeTool) });
      case "tools/call":
        return await handleToolsCall(id, req.params ?? {}, server.tools);
      case "ping":
        return ok(id, {});
      default:
        return err(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (cause) {
    return err(
      id,
      -32603,
      `Internal error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

async function handleToolsCall(
  id: string | number,
  params: Record<string, unknown>,
  tools: ReadonlyArray<ToolDefinition>,
): Promise<JsonRpcResponse> {
  const name = params.name;
  const args = params.arguments ?? {};
  if (typeof name !== "string") {
    return err(id, -32602, "Invalid params: 'name' must be a string");
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return err(id, -32601, `Unknown tool: ${name}`);
  }
  // The handler does its own schema validation and returns a structured
  // result. For MCP tools/call, we surface errors via `isError: true` on the
  // result envelope (per spec) rather than as JSON-RPC errors, so the agent's
  // model sees the failure as a tool-call response it can react to.
  const result = await tool.handler(args, {});
  if (!result.ok) {
    return ok(id, {
      isError: true,
      content: [{ type: "text", text: result.error }],
    });
  }
  return ok(id, { isError: false, content: result.content });
}

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(
  id: string | number,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
