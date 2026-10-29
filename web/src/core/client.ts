import type {
  LessonGeneratePayload,
  LessonGenerateResult,
  LessonGradePayload,
  LessonGradeResult,
  PingResult,
  Request,
  Response,
} from './types.gen';

/** The parts of a Worker the client uses; lets tests pass a fake. */
export interface WorkerLike {
  postMessage(message: Request): void;
  onmessage: ((event: MessageEvent<Response>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** Typed async access to the Go core running in a Web Worker (developer_guide.md §4.3). */
export class CoreClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => this.failAll(new Error(`core worker error: ${event.message}`));
  }

  call<T>(op: string, payload?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.worker.postMessage({ id, op, payload });
    });
  }

  ping(echo: string): Promise<PingResult> {
    return this.call<PingResult>('ping', { echo });
  }

  /** Generates a lesson performance; the answer key stays in the core (SPEC.md §6.2). */
  generateLesson(payload: LessonGeneratePayload): Promise<LessonGenerateResult> {
    return this.call<LessonGenerateResult>('lesson.generate', payload);
  }

  /** Grades the player's flags against a generated lesson's answer key (SPEC.md §6.3). */
  gradeLesson(payload: LessonGradePayload): Promise<LessonGradeResult> {
    return this.call<LessonGradeResult>('lesson.grade', payload);
  }

  private receive(response: Response): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error ?? 'core error'));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function startCore(): CoreClient {
  return new CoreClient(new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' }));
}
