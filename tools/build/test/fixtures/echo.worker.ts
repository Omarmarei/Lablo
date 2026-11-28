// Build fixture: a worker using object spread (Chromium 60, left as it is at chrome 68).
const scope = self as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  const meta = { from: 'echo-worker-marker' };
  scope.postMessage({ ...meta, echo: event.data });
};
