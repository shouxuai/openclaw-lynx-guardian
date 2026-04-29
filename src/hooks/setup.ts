import type { OpenClawPluginApi } from "../types.js";

export type LynxHookRuntimeContext = Record<string, any>;

export interface LynxHookRuntime {
  registerInputHooks(api: OpenClawPluginApi): void;
  registerToolHooks(api: OpenClawPluginApi): void;
  registerOutputHooks(api: OpenClawPluginApi): void;
  registerLifecycleHooks(api: OpenClawPluginApi): void;
}

export function registerLynxHooks(api: OpenClawPluginApi, runtime: LynxHookRuntime): void {
  runtime.registerInputHooks(api);
  runtime.registerToolHooks(api);
  runtime.registerOutputHooks(api);
  runtime.registerLifecycleHooks(api);
}
