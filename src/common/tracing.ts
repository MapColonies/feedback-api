import { Tracing } from '@map-colonies/tracing';
import { asyncCallWithSpan } from '@map-colonies/tracing-utils';
import { trace, type Span, type SpanOptions, type Tracer } from '@opentelemetry/api';
import { IGNORED_INCOMING_TRACE_ROUTES, IGNORED_OUTGOING_TRACE_ROUTES, SERVICE_NAME } from './constants';

let tracing: Tracing | undefined;

const getServiceTracer = (): Tracer => trace.getTracer(SERVICE_NAME);

export function tracingFactory(options: ConstructorParameters<typeof Tracing>[0]): Tracing {
  tracing = new Tracing({
    ...options,
    autoInstrumentationsConfigMap: {
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request): boolean =>
          IGNORED_INCOMING_TRACE_ROUTES.some((route) => request.url !== undefined && route.test(request.url)),
        ignoreOutgoingRequestHook: (request): boolean =>
          IGNORED_OUTGOING_TRACE_ROUTES.some((route) => typeof request.path === 'string' && route.test(request.path)),
      },
      '@opentelemetry/instrumentation-fs': {
        requireParentSpan: true,
      },
    },
  });

  return tracing;
}

export function getTracing(): Tracing {
  if (!tracing) {
    throw new Error('tracing not initialized');
  }
  return tracing;
}

export const withSpan = async <T>(spanName: string, spanOptions: SpanOptions, fn: (span?: Span) => Promise<T>): Promise<T> =>
  asyncCallWithSpan(fn, getServiceTracer(), spanName, spanOptions);
