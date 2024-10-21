import { DependencyContainer, FactoryFunction } from 'tsyringe';
import { Kafka, KafkaConfig, Producer, ProducerConfig } from 'kafkajs';
import { SERVICES } from '../common/constants';
import { IConfig } from '../common/interfaces';

export const kafkaClientFactory: FactoryFunction<Producer> = (container: DependencyContainer): Producer => {
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  process.env['KAFKAJS_NO_PARTITIONER_WARNING'] = '1';

  let kafkaConfig = config.get<KafkaConfig>('kafka');
  if (typeof kafkaConfig.brokers === 'string' || kafkaConfig.brokers instanceof String) {
    kafkaConfig = {
      ...kafkaConfig,
      brokers: kafkaConfig.brokers.split(','),
    };
  }
  const producerConfig = config.get<ProducerConfig>('kafkaProducer');
  const kafka = new Kafka(kafkaConfig);
  const producer = kafka.producer(producerConfig);

  return producer;
};
