import { ExecutionAuthorization, ExecutionBrokerIdentity, ExecutionPrincipal } from "./execution-broker.types";
import { ExecutionPlan, ExecutionProfile } from "./execution-plan.types";
import { DockerCommandAdapter, HttpExecutionNetworkImages, HttpResolvedAddress } from "./http-execution-network.types";

export interface ExecutionBrokerHostOptions {
  directory: string;
  installationId: string;
  hmacKey: Uint8Array;
  adminToken?: string;
  identities: ExecutionBrokerIdentity[];
  profiles: ExecutionProfile[];
  publicDataEventProfileIds?: string[];
  readAuthorization: (principal: ExecutionPrincipal, authorizationId: string) => ExecutionAuthorization | null;
  useAuthorizationLedger?: boolean;
  authorizationPlanValidator?: (plan: ExecutionPlan) => boolean;
  images: HttpExecutionNetworkImages;
  trustedNonPublicMappings: Record<string, string[]>;
  docker?: DockerCommandAdapter;
  lookup?: (hostname: string) => Promise<HttpResolvedAddress[]>;
  leaseMs?: number;
}
