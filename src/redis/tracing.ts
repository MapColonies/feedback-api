/* eslint-disable @typescript-eslint/naming-convention */
export const RedisSpanName = {
  KEYEVENT_SET: 'redis.keyevent.set',
  KEYEVENT_EXPIRED: 'redis.keyevent.expired',
  SEND_NO_CHOSEN_RESULT: 'redis.subscribe.send_no_chosen_result',
  GET_NO_CHOSEN_GEOCODING_RESPONSE: 'redis.subscribe.get_no_chosen_geocoding_response',
} as const;

export type RedisSpanName = (typeof RedisSpanName)[keyof typeof RedisSpanName];

export const RedisAttributes = {
  CHANNEL: 'redis.channel',
  KEY: 'redis.key',
  TTL_KEY: 'redis.ttl_key',
  TTL_SECONDS: 'redis.ttl_seconds',
  RESPONSE_FOUND: 'redis.response_found',
} as const;

export type RedisAttributes = (typeof RedisAttributes)[keyof typeof RedisAttributes];
