import { RedisClientOptions } from 'redis';

export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface OpenApiConfig {
  filePath: string;
  basePath: string;
  jsonPath: string;
  uiPath: string;
}

export type RedisConfig = {
  host: string;
  port: number;
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
} & RedisClientOptions;

export interface FeedbackResponse {
  requestId: string;
  chosenResultId: number;
  userId: string;
  responseTime: Date; // from FeedbackApi
  geocodingResponse: GeocodingResponse;
}

export interface GeocodingResponse {
  userId: string;
  apiKey: string;
  site: string;
  response: JSON;
  respondedAt: Date; // from Geocoding
}
