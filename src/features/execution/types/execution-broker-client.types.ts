import { ExecutionPrincipal } from "./execution-broker.types";

export interface ExecutionBrokerClientConfiguration {
  directory: string;
  principal: ExecutionPrincipal;
  clientToken: string;
  adminToken: string;
}
