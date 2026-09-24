import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  onPanel: (panel: 'checkpoint' | 'goHome') => void;
  onNavigate: (route: '/voice-protection' | '/radar' | '/network' | '/neighborhood-network' | '/how-safemelink-works' | '/protection-signal') => void;
};

export function HomeQuickActions({ onPanel, onNavigate }: Props) {
  const actions: { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; open: () => void }[] = [
    { label: 'Checkpoint', hint: 'Un controllo dopo il tempo che scegli', icon: 'timer-outline', open: () => onPanel('checkpoint') },
    { label: 'Torno a casa', hint: 'Conferma il tuo rientro', icon: 'home-outline', open: () => onPanel('goHome') },
    { label: 'Protezione vocale', hint: 'La tua parola per chiedere aiuto', icon: 'mic-outline', open: () => onNavigate('/voice-protection') },
    { label: 'Rete SafeMeLink', hint: 'Disponibilità ad aiutare negli SOS', icon: 'people-circle-outline', open: () => onNavigate('/radar') },
    { label: 'NETWORK', hint: 'Segnalazioni nella tua zona', icon: 'shield-checkmark-outline', open: () => onNavigate('/network') },
    { label: 'Rete di quartiere', hint: 'Il gruppo privato di persone invitate', icon: 'people-outline', open: () => onNavigate('/neighborhood-network') },
    { label: 'Segnale Tutela', hint: 'Segnala una situazione che ti preoccupa', icon: 'shield-outline', open: () => onNavigate('/protection-signal') },
  ];

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Accessi rapidi</Text>
      <View style={styles.grid}>
        {actions.map((action) => (
          <Pressable key={action.label} accessibilityRole="button" accessibilityHint={action.hint}
            onPress={action.open} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <Ionicons accessible={false} color="#91D8FF" name={action.icon} size={28} />
            <Text style={styles.label}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => onNavigate('/how-safemelink-works')}
        style={({ pressed }) => [styles.guide, pressed && styles.pressed]}>
        <Ionicons accessible={false} color="#91D8FF" name="help-circle-outline" size={30} />
        <View style={styles.guideCopy}>
          <Text style={styles.label}>Come funziona SafeMeLink</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 9, marginVertical: 8 },
  heading: { color: '#F7FAFF', fontSize: 19, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { flexBasis: '30%', flexGrow: 1, minWidth: 96, minHeight: 82, paddingHorizontal: 8, paddingVertical: 10, gap: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#10213D', borderColor: '#365476', borderWidth: 1, borderRadius: 14 },
  label: { color: '#F7FAFF', fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  guide: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10, backgroundColor: '#10213D', borderColor: '#365476', borderWidth: 1, borderRadius: 14 },
  guideCopy: { flex: 1 },
  pressed: { backgroundColor: '#203958' },
});
