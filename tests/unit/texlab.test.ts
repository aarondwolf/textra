import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TexlabService } from '../../src/main/services/texlab';

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
interface Message {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}
class Server extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  messages: Message[] = [];
  buffer = Buffer.alloc(0);
  stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const header = this.buffer.indexOf('\r\n\r\n');
        if (header < 0) break;
        const length = Number(this.buffer.subarray(0, header).toString().split(':')[1]?.trim());
        if (this.buffer.length < header + 4 + length) break;
        const message = JSON.parse(
          this.buffer.subarray(header + 4, header + 4 + length).toString(),
        ) as Message;
        this.buffer = this.buffer.subarray(header + 4 + length);
        this.messages.push(message);
        if (message.method === 'initialize')
          queueMicrotask(() => this.respond(message.id!, { capabilities: {} }));
        if (message.method === 'shutdown') queueMicrotask(() => this.respond(message.id!, null));
        if (message.method === 'exit') queueMicrotask(() => this.emit('close'));
      }
      done();
    },
  });
  respond(id: number, result: unknown) {
    const body = JSON.stringify({ jsonrpc: '2.0', id, result });
    this.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  kill() {
    this.killed = true;
    this.emit('close');
    return true;
  }
  requests(method: string) {
    return this.messages.filter((message) => message.method === method);
  }
}

describe('TexLab synchronization and bounded requests (mock LSP process)', () => {
  let server: Server;
  let service: TexlabService;
  const path = join(process.cwd(), 'main.tex');
  beforeEach(async () => {
    server = new Server();
    mock.spawn.mockImplementation(() => {
      queueMicrotask(() => server.emit('spawn'));
      return server;
    });
    service = new TexlabService({ requestTimeoutMs: 25 });
    await service.start({
      executable: join(process.cwd(), 'texlab'),
      workspaceRoot: process.cwd(),
    });
    await service.openDocument({ path, text: 'initial', version: 1 });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await service.stop();
  });
  it('does not publish didChange for identical content, even when providers synchronize repeatedly', async () => {
    for (let version = 1; version <= 20; version++)
      await service.openDocument({ path, text: 'initial', version });
    expect(server.requests('textDocument/didOpen')).toHaveLength(1);
    expect(server.requests('textDocument/didChange')).toHaveLength(0);
    await service.changeDocument({ path, text: 'edited', version: 21 });
    expect(server.requests('textDocument/didChange')).toHaveLength(1);
    const params = server.requests('textDocument/didChange')[0].params!;
    expect(params.textDocument).toMatchObject({ version: 21 });
  });
  it('shares identical pending requests instead of asking the server again', async () => {
    const first = service.completion(path, 0, 1);
    const second = service.completion(path, 0, 1);
    const messages = server.requests('textDocument/completion');
    expect(messages).toHaveLength(1);
    server.respond(messages[0].id!, [{ label: 'example' }]);
    expect(await first).toEqual([{ label: 'example' }]);
    expect(await second).toEqual([{ label: 'example' }]);
  });
  it('cancels superseded cursor requests on the server and resolves stale callers quietly', async () => {
    const old = service.completion(path, 0, 1);
    const latest = service.completion(path, 0, 2);
    expect(await old).toBeNull();
    const requests = server.requests('textDocument/completion');
    expect(server.requests('$/cancelRequest')[0].params).toEqual({ id: requests[0].id });
    server.respond(requests[0].id!, [{ label: 'stale' }]);
    server.respond(requests[1].id!, [{ label: 'latest' }]);
    expect(await latest).toEqual([{ label: 'latest' }]);
  });
  it('invalidates pending work after an actual document edit', async () => {
    const pending = service.hover(path, 0, 1);
    await service.changeDocument({ path, text: 'different', version: 2 });
    expect(await pending).toBeNull();
    expect(server.requests('$/cancelRequest')).toHaveLength(1);
  });
  it('ignores stale source versions without cancelling work for the newest snapshot', async () => {
    await service.changeDocument({ path, text: 'newest', version: 5 });
    const pending = service.hover(path, 0, 2);
    await service.changeDocument({ path, text: 'old', version: 2 });
    expect(service.matchesDocument(path, 'newest')).toBe(true);
    expect(service.matchesDocument(path, 'old')).toBe(false);
    expect(server.requests('textDocument/didChange')).toHaveLength(1);
    expect(server.requests('$/cancelRequest')).toHaveLength(0);
    server.respond(server.requests('textDocument/hover')[0].id!, null);
    await pending;
  });
  it('accepts a fresh Monaco version after the document closes and reopens', async () => {
    await service.changeDocument({ path, text: 'old open buffer', version: 20 });
    service.closeDocument(path);
    await service.openDocument({ path, text: 'reopened', version: 1 });
    expect(service.matchesDocument(path, 'reopened')).toBe(true);
    const opened = server.requests('textDocument/didOpen');
    expect(opened).toHaveLength(2);
    expect(opened[1].params?.textDocument).toMatchObject({ version: 1, text: 'reopened' });
  });
  it('sends protocol cancellation when a real request times out', async () => {
    vi.useFakeTimers();
    const pending = service.hover(path, 0, 1);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TEXLAB_REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(server.requests('$/cancelRequest')).toHaveLength(1);
  });
  it('bounds server concurrency and starts queued work as slots become available', async () => {
    const pending = Array.from({ length: 12 }, (_, index) =>
      service.hover(join(process.cwd(), `${index}.tex`), 0, 1),
    );
    expect(server.requests('textDocument/hover')).toHaveLength(8);
    for (let index = 0; index < 12; index++) {
      const request = server.requests('textDocument/hover')[index];
      server.respond(request.id!, null);
    }
    expect(server.requests('textDocument/hover')).toHaveLength(12);
    await Promise.all(pending);
  });
});
