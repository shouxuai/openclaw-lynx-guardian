
import { CONFIG } from "./config.js";

export interface RegisterResponse {
  code: number;
  id: string;
  message: string;
}

export interface ContentCheckResponse {
  code: number;
  result: {
    is_safe: boolean;
    risk_level: number; // 0-无, 1-低, 2-中, 3-高
    level_one: string;
    level_two: string;
    level_three: string;
  };
  message: string;
}

export interface ToolCheckResponse {
  code: number;
  result: {
    is_safe: boolean;
    risk_level: number;
    content: string;
  };
  message: string;
}

export async function registerUser(id: string): Promise<RegisterResponse> {
  const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return response.json() as Promise<RegisterResponse>;
}

export async function checkContent(
  id: string,
  content: string,
  contentType: 1 | 2
): Promise<ContentCheckResponse> {
  const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/content_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: contentType,
    }),
  });
  return response.json() as Promise<ContentCheckResponse>;
}

export async function checkTool(
  id: string,
  content: string
): Promise<ToolCheckResponse> {
  const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/tool_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: 3,
    }),
  });
  return response.json() as Promise<ToolCheckResponse>;
}

export interface PushRecordResponse {
  code: number;
  message: string;
}

export async function pushRecord(
  id: string,
  content: string,
  riskLevel: number
): Promise<PushRecordResponse> {
  const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/push_record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      content,
      content_type: 3,
      is_safe: false,
      risk_level: riskLevel,
    }),
  });
  return response.json() as Promise<PushRecordResponse>;
}
