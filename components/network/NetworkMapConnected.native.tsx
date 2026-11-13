import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { NetworkMap } from './NetworkMap.native';
import type { NetworkMapProps } from './NetworkMap.types';
import type { NetworkMapController } from '@/services/NetworkMapController';

/** No router/auth/backend coupling. Caller owns context, source and controller disposal. */
export function NetworkMapConnected({ controller, ...mapProps }: Omit<NetworkMapProps, 'snapshot'> & { controller: NetworkMapController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => {
    controller.revalidateTime();
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') controller.revalidateTime(); });
    return () => subscription.remove();
  }, [controller]);
  return <NetworkMap {...mapProps} snapshot={state.snapshot} />;
}
