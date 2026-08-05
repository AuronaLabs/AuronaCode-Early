import { invokeDesktop } from "../Desktop";

export const PerformanceIPC = {
  ping: () => invokeDesktop<string>("performance_ping"),
  getEnvironment: <T>(workspacePath: string | null) =>
    invokeDesktop<T>("get_performance_environment", { workspacePath }),
  getStartupMetrics: <T>() => invokeDesktop<T>("get_startup_metrics"),
  loadBaseline: <T>() => invokeDesktop<T>("load_performance_baseline"),
  runBenchmark: <T>(kind: string, requestId: string) =>
    invokeDesktop<T>("run_performance_benchmark", { kind, requestId }),
  cancelBenchmark: (requestId: string) =>
    invokeDesktop<void>("cancel_performance_benchmark", { requestId }),
  saveBaseline: (baseline: unknown) =>
    invokeDesktop<void>("save_performance_baseline", { baseline }),
};
