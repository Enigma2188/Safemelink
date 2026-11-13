import { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import type { NetworkV2Composition } from '@/services/NetworkV2Composition';
import { NetworkSocialPanel } from '@/components/network/NetworkSocialPanel.native';
import { NetworkV2Screen } from './NetworkV2Screen.native';
import { EMPTY_NETWORK_RECOVERY } from '@/services/NetworkWriteRecovery';
import { NetworkRecoveryPanel } from '@/components/network/NetworkRecoveryPanel.native';
const subscribeEmpty = () => () => {};
const getEmpty = () => EMPTY_NETWORK_RECOVERY;

/** Isolated composition entry; no route/export in production navigation. Owner disposes on final teardown. */
export function NetworkV2Entry({ composition, configuration, mapProvider, onClose }: {
  composition: NetworkV2Composition | null; configuration: 'READY' | 'MISSING';
  mapProvider?: 'PLATFORM_DEFAULT' | 'GOOGLE_ANDROID'; onClose?: () => void;
}) {
  // Navigation unmount must not discard an UNKNOWN write or the existing publication runtime.
  // The app owner, not the view, stops/disposes the composition on its final lifecycle boundary.
  useEffect(() => { composition?.start(); return () => composition?.social.suspend(); }, [composition]);
  const recovery = useSyncExternalStore(composition?.recovery?.subscribe ?? subscribeEmpty, composition?.recovery?.getState ?? getEmpty, getEmpty);
  if (!composition) return <Text>NETWORK V2 disabilitato.</Text>;
  if (composition.recovery && !['OFF','READY','WRITING'].includes(recovery.phase)) return <NetworkRecoveryPanel recovery={composition.recovery} state={recovery} />;
  return <View style={{ flex: 1 }}>{composition.recovery && recovery.phase === 'READY' && recovery.notice ? <NetworkRecoveryPanel recovery={composition.recovery} state={recovery} /> : null}
    <NetworkV2Screen runtime={composition.runtime} configuration={configuration} mapProvider={mapProvider} onClose={onClose}
    socialSlots={{ confirmations: detail => <NetworkSocialPanel key={detail.marker.publicId} controller={composition.social} detail={detail} />,
      follow: () => null, conversation: () => null, activity: () => null }} /></View>;
}
