type SOSLaunchListener = (userId: string) => void;

let listener: SOSLaunchListener | null = null;
let pendingUserId: string | null = null;

export const SOSLaunchRuntime = {
  subscribe(next: SOSLaunchListener) {
    listener = next;
    if (pendingUserId) {
      const userId = pendingUserId;
      pendingUserId = null;
      next(userId);
    }
    return () => { if (listener === next) listener = null; };
  },
  request(userId: string) {
    if (listener) listener(userId);
    else pendingUserId = userId;
  },
};
