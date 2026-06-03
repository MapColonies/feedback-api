/* eslint-disable @typescript-eslint/naming-convention */
import jsLogger from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { Producer } from 'kafkajs';
import { redisSubscribe } from '../../../src/redis/subscribe';
import { REDIS_SUB, SERVICES } from '../../../src/common/constants';

type SetCallback = (message: string) => Promise<void>;
type ExpiredCallback = (message: string) => Promise<void>;

const buildConfig = (prefix?: string): { get: jest.Mock; has: jest.Mock } => ({
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'redis.expiredResponseTtl') {
      return 300;
    }
    if (key === 'redis.prefix') {
      return prefix;
    }
    if (key === 'outputTopic') {
      return 'test-topic';
    }
    return undefined;
  }),
  has: jest.fn().mockImplementation((key: string) => key === 'redis.prefix' && prefix !== undefined),
});

describe('redisSubscribe', () => {
  let mockRedisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let mockSubscriber: { subscribe: jest.Mock };
  let mockProducer: { send: jest.Mock };
  let setCallback: SetCallback;
  let expiredCallback: ExpiredCallback;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    mockSubscriber = {
      subscribe: jest.fn().mockImplementation((channel: string, callback: SetCallback | ExpiredCallback) => {
        if (channel.includes(':set')) {
          setCallback = callback as SetCallback;
        }
        if (channel.includes(':expired')) {
          expiredCallback = callback as ExpiredCallback;
        }
      }),
    };

    mockProducer = { send: jest.fn().mockResolvedValue(undefined) };
  });

  const setup = async (prefix?: string): Promise<void> => {
    const mockContainer = {
      resolve: jest.fn().mockImplementation((token: symbol) => {
        if (token === SERVICES.REDIS) {
          return mockRedisClient;
        }
        if (token === REDIS_SUB) {
          return mockSubscriber;
        }
        if (token === SERVICES.CONFIG) {
          return buildConfig(prefix);
        }
        if (token === SERVICES.KAFKA) {
          return mockProducer as unknown as Producer;
        }
        if (token === SERVICES.LOGGER) {
          return jsLogger({ enabled: false });
        }
        return undefined;
      }),
    } as unknown as DependencyContainer;

    await redisSubscribe(mockContainer);
  };

  // ─── SET event: isTtlKey guard ────────────────────────────────────────────

  describe('SET event — isTtlKey guard (no prefix)', () => {
    beforeEach(async () => setup());

    it('should NOT create a TTL key when message starts with "ttl:" (own sentinel)', async () => {
      await setCallback('ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should NOT create a TTL key when message contains ":ttl:" (cross-instance sentinel)', async () => {
      await setCallback('geo:ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should NOT create a TTL key for deeply nested TTL keys (the loop pattern)', async () => {
      await setCallback('ttl:ttl:ttl:ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should create a TTL key for a normal UUID key', async () => {
      await setCallback('abc123-def456');
      expect(mockRedisClient.set).toHaveBeenCalledWith('ttl:abc123-def456', '', { EX: 300 });
    });
  });

  describe('SET event — isTtlKey guard (with prefix)', () => {
    beforeEach(async () => setup('geocoding'));

    it('should NOT create a TTL key when message starts with "ttl:" (different instance, no prefix)', async () => {
      await setCallback('ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should NOT create a TTL key when message contains own prefix sentinel', async () => {
      await setCallback('geocoding:ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should NOT create a TTL key when message contains ":ttl:" from a different prefix (cross-instance)', async () => {
      await setCallback('other_service:ttl:some-uuid');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should create a TTL key for a prefixed original key', async () => {
      await setCallback('geocoding:some-uuid');
      expect(mockRedisClient.set).toHaveBeenCalledWith('geocoding:ttl:some-uuid', '', { EX: 300 });
    });

    it('should preserve the full key when stripping prefix — not truncate at second colon', async () => {
      // old bug: split(':')[1] would give "part1" instead of "part1:part2:part3"
      await setCallback('geocoding:part1:part2:part3');
      expect(mockRedisClient.set).toHaveBeenCalledWith('geocoding:ttl:part1:part2:part3', '', { EX: 300 });
    });
  });

  // ─── EXPIRED event handler ────────────────────────────────────────────────

  describe('EXPIRED event handler', () => {
    beforeEach(async () => setup());

    it('should send no-chosen result to Kafka when wasUsed is false', async () => {
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ wasUsed: false }));
      await expiredCallback('ttl:some-uuid');
      expect(mockProducer.send).toHaveBeenCalled();
    });

    it('should NOT send to Kafka when wasUsed is true', async () => {
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ wasUsed: true }));
      await expiredCallback('ttl:some-uuid');
      expect(mockProducer.send).not.toHaveBeenCalled();
    });

    it('should always delete the original key after expiry', async () => {
      mockRedisClient.get.mockResolvedValue(JSON.stringify({ wasUsed: true }));
      await expiredCallback('ttl:some-uuid');
      expect(mockRedisClient.del).toHaveBeenCalledWith('some-uuid');
    });

    it('should ignore expired keys that are not TTL sentinels', async () => {
      await expiredCallback('regular-key');
      expect(mockRedisClient.get).not.toHaveBeenCalled();
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });
  });
});
