/** Messages between the hello screen and its worker. */
export interface HelloPing {
  readonly type: 'ping';
  readonly nonce: number;
}

export interface HelloPong {
  readonly type: 'pong';
  readonly nonce: number;
  /** Runtime-baseline APIs (spike S1) that exist inside the worker. */
  readonly features: string[];
}
