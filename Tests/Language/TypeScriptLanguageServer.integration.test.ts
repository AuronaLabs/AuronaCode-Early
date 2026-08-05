// @vitest-environment node
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const normalizeFileUri = (uri: string) => decodeURIComponent(uri).toLowerCase();

class TestRpcClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notifications = new Map<string, RpcMessage[]>();

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.decode();
    });
    child.on("exit", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Language server exited before responding"));
      }
      this.pending.clear();
    });
  }

  request<Result>(method: string, params: unknown): Promise<Result> {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as Result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async waitForNotification(method: string): Promise<RpcMessage> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const queued = this.notifications.get(method)?.shift();
      if (queued) return queued;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for notification ${method}`);
  }

  private write(message: object): void {
    const body = Buffer.from(JSON.stringify(message));
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private decode(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = Number.parseInt(
        header
          .split("\r\n")
          .find((line) => line.toLowerCase().startsWith("content-length:"))
          ?.split(":")[1]
          ?.trim() ?? "",
        10,
      );
      const bodyStart = headerEnd + 4;
      if (!Number.isFinite(length) || this.buffer.length < bodyStart + length) return;
      const message = JSON.parse(
        this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8"),
      ) as RpcMessage;
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.route(message);
    }
  }

  private route(message: RpcMessage): void {
    if (message.id !== undefined && message.method) {
      const result =
        message.method === "workspace/configuration"
          ? Array(((message.params as { items?: unknown[] })?.items ?? []).length).fill(null)
          : null;
      this.write({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const queued = this.notifications.get(message.method) ?? [];
      queued.push(message);
      this.notifications.set(message.method, queued);
    }
  }
}

describe("real TypeScript Language Server", () => {
  let workspace = "";
  let mainPath = "";
  let helperPath = "";
  let mainUri = "";
  let helperUri = "";
  let child: ChildProcessWithoutNullStreams;
  let rpc: TestRpcClient;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "aurona-lsp-"));
    mainPath = join(workspace, "main.ts");
    helperPath = join(workspace, "helper.ts");
    mainUri = pathToFileURL(mainPath).toString();
    helperUri = pathToFileURL(helperPath).toString();
    await writeFile(
      mainPath,
      'import { helper } from "./helper";\nconst result: string = helper(1);\nhelper(2);\n',
    );
    await writeFile(helperPath, "export function helper(value: number) { return value + 1; }\n");
    await writeFile(
      join(workspace, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, files: ["main.ts", "helper.ts"] }),
    );

    const cli = join(process.cwd(), "node_modules", "typescript-language-server", "lib", "cli.mjs");
    child = spawn(process.execPath, [cli, "--stdio"], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    rpc = new TestRpcClient(child);
    const initialize = await rpc.request<{ capabilities: Record<string, unknown> }>("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(workspace).toString(),
      workspaceFolders: [{ uri: pathToFileURL(workspace).toString(), name: "integration" }],
      capabilities: {
        workspace: { configuration: true },
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          rename: { prepareSupport: true },
          formatting: {},
          codeAction: {},
        },
      },
    });
    expect(initialize.capabilities).toBeTruthy();
    rpc.notify("initialized", {});
    rpc.notify("textDocument/didOpen", {
      textDocument: {
        uri: mainUri,
        languageId: "typescript",
        version: 1,
        text: await (await import("node:fs/promises")).readFile(mainPath, "utf8"),
      },
    });
  }, 20_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      await rpc.request("shutdown", null).catch(() => undefined);
      rpc.notify("exit", null);
      const exitedGracefully = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      if (!exitedGracefully) child.kill();
      expect(exitedGracefully).toBe(true);
    }
    if (workspace.startsWith(tmpdir())) {
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100,
      });
    }
  });

  it("publishes diagnostics for the opened document", async () => {
    let params: { uri: string; diagnostics: unknown[] };
    do {
      const notification = await rpc.waitForNotification("textDocument/publishDiagnostics");
      params = notification.params as { uri: string; diagnostics: unknown[] };
    } while (
      normalizeFileUri(params.uri) !== normalizeFileUri(mainUri) ||
      params.diagnostics.length === 0
    );
    expect(normalizeFileUri(params.uri)).toBe(normalizeFileUri(mainUri));
    expect(params.diagnostics.length).toBeGreaterThan(0);
  }, 20_000);

  it("serves completion, hover, definition, references, symbols, rename and formatting", async () => {
    const document = { uri: mainUri };
    const usage = { line: 1, character: 25 };
    const completion = await rpc.request<
      | { items?: Array<{ label: string }> }
      | Array<{
          label: string;
        }>
    >("textDocument/completion", {
      textDocument: document,
      position: { line: 2, character: 3 },
      context: { triggerKind: 1 },
    });
    const completionItems = Array.isArray(completion) ? completion : (completion.items ?? []);
    expect(completionItems.some((item) => item.label === "helper")).toBe(true);

    expect(
      await rpc.request("textDocument/hover", { textDocument: document, position: usage }),
    ).toBeTruthy();
    const definition = await rpc.request<Array<{ uri: string }> | { uri: string }>(
      "textDocument/definition",
      { textDocument: document, position: usage },
    );
    expect(normalizeFileUri(JSON.stringify(definition))).toContain(normalizeFileUri(helperUri));

    const references = await rpc.request<Array<{ uri: string }>>("textDocument/references", {
      textDocument: document,
      position: usage,
      context: { includeDeclaration: true },
    });
    expect(references.length).toBeGreaterThanOrEqual(3);

    const symbols = await rpc.request<unknown[]>("textDocument/documentSymbol", {
      textDocument: document,
    });
    expect(symbols.length).toBeGreaterThan(0);
    expect(
      await rpc.request("textDocument/prepareRename", {
        textDocument: document,
        position: usage,
      }),
    ).toBeTruthy();
    expect(
      await rpc.request("textDocument/rename", {
        textDocument: document,
        position: usage,
        newName: "renamedHelper",
      }),
    ).toBeTruthy();
    const edits = await rpc.request<unknown[]>("textDocument/formatting", {
      textDocument: document,
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(Array.isArray(edits)).toBe(true);
  }, 20_000);

  it("supports didChange, didSave and didClose without terminating the server", () => {
    rpc.notify("textDocument/didChange", {
      textDocument: { uri: mainUri, version: 2 },
      contentChanges: [{ text: 'import { helper } from "./helper";\nhelper(3);\n' }],
    });
    rpc.notify("textDocument/didSave", { textDocument: { uri: mainUri } });
    rpc.notify("textDocument/didClose", { textDocument: { uri: mainUri } });
    expect(child.exitCode).toBeNull();
  }, 15_000);
});
