import { Application } from 'express';
import { DependencyContainer } from 'tsyringe';
import { registerExternalValues, RegisterOptions } from './containerConfig';
import { ServerBuilder } from './serverBuilder';

export const getApp = async (registerOptions?: RegisterOptions): Promise<{ app: Application; container: DependencyContainer }> => {
  const container = await registerExternalValues(registerOptions);
  const app = container.resolve(ServerBuilder).build();
  return { app, container };
};
