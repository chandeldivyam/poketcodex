export const YOLO_APPROVAL_POLICY = "never";

export interface DangerFullAccessSandboxPolicy {
  type: "dangerFullAccess";
}

export const YOLO_SANDBOX_POLICY: DangerFullAccessSandboxPolicy = {
  type: "dangerFullAccess"
};

export function withYoloThreadConfig(params: Record<string, unknown>): Record<string, unknown> {
  return {
    ...params,
    approvalPolicy: YOLO_APPROVAL_POLICY,
    sandbox: YOLO_SANDBOX_POLICY.type
  };
}

export function withYoloTurnConfig(params: Record<string, unknown>): Record<string, unknown> {
  return {
    ...params,
    approvalPolicy: YOLO_APPROVAL_POLICY,
    sandboxPolicy: YOLO_SANDBOX_POLICY
  };
}
