import { Type, type Static } from '@sinclair/typebox';
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

export const geocodingResponseSchema = Type.Object({
  userId: Type.Optional(Type.String()),
  apiKey: Type.String(),
  site: Type.String(),
  response: Type.Any(),
  respondedAt: Type.Unsafe<Date>({ type: 'string' }),
  wasUsed: Type.Optional(Type.Boolean()),
});

export type GeocodingResponse = Static<typeof geocodingResponseSchema>;
