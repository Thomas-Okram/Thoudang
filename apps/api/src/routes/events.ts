import { Router, type Request, type Response } from 'express';
import type { EventBus, PipelineEvent } from '../events.js';

/** Opens a Server-Sent Events stream of the bus events that pass `matches`. */
export function streamEvents(
  req: Request,
  res: Response,
  bus: EventBus,
  matches: (e: PipelineEvent) => boolean,
  heartbeatMs = 15_000,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n: connected\n\n');
  const unsubscribe = bus.subscribe((e) => {
    if (matches(e)) res.write(`data: ${JSON.stringify(e)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

/** Server-Sent Events: GET /api/events[?caseId=&batchId=&sessionId=] */
export function eventsRouter(bus: EventBus, opts: { heartbeatMs?: number } = {}): Router {
  const router = Router();
  router.get('/events', (req, res) => {
    const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : null);
    const caseId = q('caseId');
    const batchId = q('batchId');
    const sessionId = q('sessionId');
    const matches = (e: PipelineEvent) => {
      if (e.type === 'session') return !sessionId || e.sessionId === sessionId;
      if (caseId && e.caseId !== caseId) return false;
      if (batchId && e.batchId !== batchId) return false;
      return true;
    };
    streamEvents(req, res, bus, matches, opts.heartbeatMs);
  });
  return router;
}
