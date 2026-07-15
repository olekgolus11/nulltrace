const generatedRuntimeId = crypto.randomUUID();

export function getAuthenticationRuntimeId() {
  return process.env.NULLTRACE_RUNTIME_ID ?? generatedRuntimeId;
}
