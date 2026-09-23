import { ExecutionAuthorization, ExecutionBrokerIdentity, ExecutionPrincipal } from "./execution-broker.types";
import { ExecutionProfile } from "./execution-plan.types";
import { DockerCommandAdapter, HttpExecutionNetworkImages, HttpResolvedAddress } from "./http-execution-network.types";

export interface ExecutionBrokerHostOptions {
  directory: string;
  installationId: string;
  hmacKey: Uint8Array;
  identities: ExecutionBrokerIdentity[];
  profiles: ExecutionProfile[];
  readAuthorization: (principal: ExecutionPrincipal, authorizationId: string) => ExecutionAuthorization | null;
  images: HttpExecutionNetworkImages;
  trustedNonPublicMappings: Record<string, string[]>;
  docker?: DockerCommandAdapter;
  lookup?: (hostname: string) => Promise<HttpResolvedAddress[]>;
  leaseMs?: number;
}
