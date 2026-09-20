declare module "libfx/browser" {
  export type Agent = Readonly<{ checkpoint: () => Promise<Uint8Array>; close: () => Promise<void> }>
  export function supportsJspi(): boolean
  export function createFxAgent(
    options: Readonly<{ apiKey: string; wasm: string; checkpoint?: Uint8Array }>,
  ): Promise<Agent>
}
