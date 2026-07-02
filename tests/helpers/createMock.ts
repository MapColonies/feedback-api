import type { Mock, MockedObject } from 'vitest';

export const createMock = <T>(partial: Partial<Record<keyof T, Mock>>): MockedObject<T> => partial as MockedObject<T>;
