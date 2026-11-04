/** GET and parse JSON from the lab server with XHR (no `fetch` cancellation on Chromium 53). */
export function xhrJson(url: string, timeoutMs = 2 * 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status !== 200) {
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('the answer is not JSON'));
      }
    };
    xhr.onerror = () => reject(new Error('no answer'));
    xhr.ontimeout = () => reject(new Error(`no answer within ${timeoutMs} ms`));
    xhr.send();
  });
}
