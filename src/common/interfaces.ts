import type { vectorFeedbackApiV1Type } from '@map-colonies/schemas';

export interface OpenApiConfig {
  filePath: string;
  basePath: string;
  jsonPath: string;
  uiPath: string;
}

export type RedisConfig = vectorFeedbackApiV1Type['redis'];

export interface FeedbackResponse {
  requestId: string;
  chosenResultId: number | null;
  userId: string;
  responseTime: Date; // from FeedbackApi
  geocodingResponse: GeocodingResponse;
}

export interface GeocodingResponse {
  userId?: string;
  apiKey: string;
  site: string;
  response: JSON;
  respondedAt: Date; // from Geocoding
  wasUsed?: boolean;
}
