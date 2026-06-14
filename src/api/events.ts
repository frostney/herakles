import type { HeraklesEvent, HeraklesEventType } from "../domain";

type Subscriber = (event: HeraklesEvent) => void;

const subscribers = new Set<Subscriber>();
let eventId = 0;

export function emitApiEvent(
  type: HeraklesEventType,
  message: string,
  payload?: Record<string, unknown>,
): HeraklesEvent {
  const event = createApiEvent(type, message, payload);
  for (const subscriber of subscribers) {
    subscriber(event);
  }
  return event;
}

export function createEventStream(): Response {
  const encoder = new TextEncoder();
  let subscriber: Subscriber | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = (event) => {
        controller.enqueue(encoder.encode(formatEvent(event)));
      };
      subscribers.add(subscriber);
      subscriber(
        createApiEvent("connected", "event stream connected", { subscribers: subscribers.size }),
      );
    },
    cancel() {
      if (subscriber) subscribers.delete(subscriber);
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}

function createApiEvent(
  type: HeraklesEventType,
  message: string,
  payload?: Record<string, unknown>,
): HeraklesEvent {
  return {
    id: ++eventId,
    type,
    generatedAt: new Date().toISOString(),
    message,
    ...(payload ? { payload } : {}),
  };
}

function formatEvent(event: HeraklesEvent): string {
  return `id: ${event.id}
event: herakles
data: ${JSON.stringify(event)}

`;
}
