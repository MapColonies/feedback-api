import { readFileSync } from 'fs';
import { DependencyContainer, FactoryFunction } from 'tsyringe';
import { Kafka, Producer, ProducerConfig } from 'kafkajs';
import { SERVICES } from '../common/constants';
import { IConfig, KafkaOptions } from '../common/interfaces';

export const kafkaClientFactory: FactoryFunction<Producer> = (container: DependencyContainer): Producer => {
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  process.env['KAFKAJS_NO_PARTITIONER_WARNING'] = '1';

  let kafkaConfig = config.get<KafkaOptions>('kafka');
  if (typeof kafkaConfig.brokers === 'string' || kafkaConfig.brokers instanceof String) {
    kafkaConfig = {
      ...kafkaConfig,
      brokers: kafkaConfig.brokers.split(','),
    };
  }
  if (kafkaConfig.enableSslAuth) {
    kafkaConfig = {
      ...kafkaConfig,
      ssl: {
        key: readFileSync(kafkaConfig.sslPaths.key, 'utf-8'),
        cert: readFileSync(kafkaConfig.sslPaths.cert, 'utf-8'),
        ca: [readFileSync(kafkaConfig.sslPaths.ca, 'utf-8')],
      },
    };
  }
  const producerConfig = config.get<ProducerConfig>('kafkaProducer');
  const kafka = new Kafka(kafkaConfig);
  const producer = kafka.producer(producerConfig);

  return producer;
};
