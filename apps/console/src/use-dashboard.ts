import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ActionItem,
  type AuditItem,
  type ConnectorItem,
  type EventItem,
  type ForgeItem,
  type MemoryItem,
  type RunItem,
} from "./api";

export type Resource<T> = {
  data: T;
  error?: string;
  loading: boolean;
  updatedAt?: number;
};

type DashboardResources = {
  events: Resource<EventItem[]>;
  actions: Resource<ActionItem[]>;
  runs: Resource<RunItem[]>;
  audit: Resource<AuditItem[]>;
  memory: Resource<MemoryItem[]>;
  connectors: Resource<ConnectorItem[]>;
  forges: Resource<ForgeItem[]>;
};

type ResourceKey = keyof DashboardResources;
export type ConnectionStatus = "online" | "degraded" | "offline" | "connecting";

export function getConnectionStatus(
  resources: Array<Pick<Resource<unknown>, "error" | "updatedAt">>,
): ConnectionStatus {
  const loaded = resources.filter((resource) => resource.updatedAt !== undefined).length;
  const failed = resources.filter((resource) => resource.error !== undefined).length;
  if (loaded === 0 && failed === 0) return "connecting";
  if (loaded === 0) return "offline";
  return failed > 0 ? "degraded" : "online";
}

const empty = <T>(data: T): Resource<T> => ({ data, loading: true });
const initial: DashboardResources = {
  events: empty<EventItem[]>([]),
  actions: empty<ActionItem[]>([]),
  runs: empty<RunItem[]>([]),
  audit: empty<AuditItem[]>([]),
  memory: empty<MemoryItem[]>([]),
  connectors: empty<ConnectorItem[]>([]),
  forges: empty<ForgeItem[]>([]),
};

const loaders = {
  events: api.events,
  actions: api.actions,
  runs: api.runs,
  audit: api.audit,
  memory: api.memory,
  connectors: api.connectors,
  forges: api.forges,
} satisfies {
  [K in ResourceKey]: (signal?: AbortSignal) => Promise<DashboardResources[K]["data"]>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

export function useDashboard(pollInterval = 5_000) {
  const [resources, setResources] = useState<DashboardResources>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setRefreshing(true);

    const operation = Promise.all(
      Object.entries(loaders).map(async ([untypedKey, loader]) => {
        const key = untypedKey as ResourceKey;
        try {
          const data = await loader(nextController.signal);
          if (nextController.signal.aborted) return;
          setResources((current) => ({
            ...current,
            [key]: { data, loading: false, updatedAt: Date.now() },
          }));
        } catch (error) {
          if (nextController.signal.aborted) return;
          setResources((current) => ({
            ...current,
            [key]: { ...current[key], loading: false, error: errorMessage(error) },
          }));
        }
      }),
    )
      .then(() => undefined)
      .finally(() => {
        if (controller.current === nextController) {
          controller.current = undefined;
          inFlight.current = undefined;
          setRefreshing(false);
        }
      });
    inFlight.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollInterval);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
      controller.current = undefined;
      inFlight.current = undefined;
    };
  }, [pollInterval, refresh]);

  const status = useMemo<ConnectionStatus>(() => {
    return getConnectionStatus(Object.values(resources));
  }, [resources]);

  return { resources, status, refreshing, refresh };
}
