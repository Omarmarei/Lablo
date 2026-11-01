// Build fixture: a worker using syntax newer than Chromium 53 (object spread).
const scope = self as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  const meta = { from: 'echo-worker-marker' };
  scope.postMessage({ ...meta, echo: event.data });
};
