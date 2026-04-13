import { readFileSync } from "fs";
import type { Logger, PluginConfig } from "../types.js";

interface JsonSchemaNode {
  type?: string;
  default?: unknown;
  properties?: Record<string, JsonSchemaNode>;
}

let cachedPluginConfigDefaults: Record<string, unknown> | null = null;
let cachedPluginConfigDefaultsError: string | null = null;
let warnedAboutPluginConfigDefaults = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractSchemaDefaults(schema: JsonSchemaNode | undefined): unknown {
  if (!schema || typeof schema !== "object") {
    return undefined;
  }

  const propertyDefaults = extractObjectPropertyDefaults(schema.properties);
  if (Object.prototype.hasOwnProperty.call(schema, "default")) {
    const schemaDefault = cloneJsonValue(schema.default);
    if (isPlainObject(schemaDefault) && isPlainObject(propertyDefaults)) {
      return mergeDefinedValues(propertyDefaults, schemaDefault);
    }
    return schemaDefault;
  }

  if (schema.type === "object" || isPlainObject(schema.properties)) {
    return propertyDefaults;
  }

  return undefined;
}

function extractObjectPropertyDefaults(
  properties: Record<string, JsonSchemaNode> | undefined,
): Record<string, unknown> | undefined {
  if (!isPlainObject(properties)) {
    return undefined;
  }

  const defaults: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const nestedDefault = extractSchemaDefaults(value);
    if (nestedDefault !== undefined) {
      defaults[key] = nestedDefault;
    }
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function mergeDefinedValues(defaults: unknown, explicit: unknown): unknown {
  if (explicit === undefined) {
    return cloneJsonValue(defaults);
  }

  if (defaults === undefined) {
    return cloneJsonValue(explicit);
  }

  if (isPlainObject(defaults) && isPlainObject(explicit)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(defaults), ...Object.keys(explicit)]);
    for (const key of keys) {
      merged[key] = mergeDefinedValues(defaults[key], explicit[key]);
    }
    return merged;
  }

  return cloneJsonValue(explicit);
}

function loadPluginConfigDefaults(logger?: Pick<Logger, "warn">): Record<string, unknown> {
  if (cachedPluginConfigDefaults) {
    return cachedPluginConfigDefaults;
  }

  if (cachedPluginConfigDefaultsError) {
    if (logger && !warnedAboutPluginConfigDefaults) {
      warnedAboutPluginConfigDefaults = true;
      logger.warn(cachedPluginConfigDefaultsError);
    }
    return {};
  }

  try {
    const manifestPath = new URL("../../openclaw.plugin.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { configSchema?: JsonSchemaNode };
    const defaults = extractSchemaDefaults(manifest.configSchema);
    cachedPluginConfigDefaults = isPlainObject(defaults) ? defaults : {};
    return cachedPluginConfigDefaults;
  } catch (error: any) {
    cachedPluginConfigDefaultsError = `[lynx-guardian] Failed to load plugin config defaults: ${error.message}`;
    if (logger && !warnedAboutPluginConfigDefaults) {
      warnedAboutPluginConfigDefaults = true;
      logger.warn(cachedPluginConfigDefaultsError);
    }
    return {};
  }
}

export function resolvePluginRuntimeConfig(
  inlineConfig?: PluginConfig,
  logger?: Pick<Logger, "warn">,
): PluginConfig {
  const defaults = loadPluginConfigDefaults(logger);
  const explicitConfig = isPlainObject(inlineConfig) ? inlineConfig : {};
  return mergeDefinedValues(defaults, explicitConfig) as PluginConfig;
}
