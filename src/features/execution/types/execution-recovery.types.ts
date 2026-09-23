export interface ExecutionResourceReconciler {
  reconcileOwnedResources(): Promise<void>;
}
