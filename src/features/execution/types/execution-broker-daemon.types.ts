import { ExecutionBrokerHostOptions } from "./execution-broker-host.types";

export interface ExecutionBrokerDaemonStartup {
  hostOptions: ExecutionBrokerHostOptions;
  dockerExecutable: string;
}
