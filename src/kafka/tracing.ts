/* eslint-disable @typescript-eslint/naming-convention */
export const KafkaSpanName = {
  SEND: 'kafka.send',
} as const;

export type KafkaSpanName = (typeof KafkaSpanName)[keyof typeof KafkaSpanName];

export const KafkaAttributes = {
  TOPIC: 'messaging.destination.name',
} as const;

export type KafkaAttributes = (typeof KafkaAttributes)[keyof typeof KafkaAttributes];
