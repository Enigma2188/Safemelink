import * as Location from 'expo-location';
import { withSafetyTimeout } from '@/services/SafetyOperation';

export type DestinationCandidate = { latitude: number; longitude: number; label: string };
export async function findDestinationAddress(address: string): Promise<DestinationCandidate[]> {
  const query = address.trim();
  if (query.length < 5 || query.length > 250) throw new Error('Inserisci via, numero e città (5–250 caratteri).');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Consenti la posizione per cercare un indirizzo.');
  try {
    const positions = await withSafetyTimeout(Location.geocodeAsync(query), 'address_lookup', 12_000);
    const unique = positions.filter((p, i, all) => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
      Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 &&
      all.findIndex((other) => other.latitude === p.latitude && other.longitude === p.longitude) === i);
    return await Promise.all(unique.slice(0, 5).map(async (p) => {
      const labels = await withSafetyTimeout(Location.reverseGeocodeAsync(p), 'address_label', 5_000).catch(() => []);
      const a = labels[0];
      return { latitude: p.latitude, longitude: p.longitude,
        label: a ? [a.street, a.streetNumber, a.postalCode, a.city, a.region, a.country].filter(Boolean).join(', ') :
          `${query} — ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` };
    }));
  } catch { throw new Error('Ricerca indirizzo non disponibile. Controlla la connessione e riprova.'); }
}
