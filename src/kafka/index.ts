import { readFileSync } from 'node:fs';
import type { DependencyContainer, FactoryFunction } from 'tsyringe';
import { type Producer, Kafka } from 'kafkajs';
import type { ConfigType } from '@src/common/config';
import { SERVICES } from '../common/constants';

export const kafkaClientFactory: FactoryFunction<Producer> = (container: DependencyContainer): Producer => {
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  process.env['KAFKAJS_NO_PARTITIONER_WARNING'] = '1';
  let kafkaConfig = config.get('kafka');
  kafkaConfig = {
    ...kafkaConfig,
    brokers: kafkaConfig.brokers,
    ssl: kafkaConfig.enableSslAuth
      ? {
          key: readFileSync(kafkaConfig.sslPaths.key!, 'utf-8'),
          cert: readFileSync(kafkaConfig.sslPaths.cert!, 'utf-8'),
          ca: kafkaConfig.sslPaths.ca != null ? [readFileSync(kafkaConfig.sslPaths.ca, 'utf-8')] : undefined,
        }
      : undefined,
    sasl: kafkaConfig.sasl ? { ...kafkaConfig.sasl } : undefined,
  };
  const producerConfig = config.get('kafka.producer');
  const kafka = new Kafka(kafkaConfig);
  const producer = kafka.producer(producerConfig);

  return producer;
};
