import type { Mock, MockedObject } from 'vitest';
import type { GeocodingResponse } from '@common/interfaces';

export const createMock = <T>(partial: Partial<Record<keyof T, Mock>>): MockedObject<T> => partial as MockedObject<T>;

export const makeGeocodingResponseJson = (overrides: Partial<GeocodingResponse> = {}): string =>
  JSON.stringify({
    apiKey: 'test-api-key',
    site: 'test-site',
    response: {},
    respondedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });
